'use strict';
/**
 * How bytes (or a rendered page) actually reach a printer. Three transports, all injectable for tests:
 *
 *  - network     raw TCP (port 9100 is the usual "RAW/JetDirect" port) straight to a LAN thermal printer.
 *  - spooler-raw raw ESC/POS bytes handed to an installed Windows printer queue through winspool (OpenPrinter /
 *                StartDocPrinter "RAW" / WritePrinter), driven by a small PowerShell script. No native module.
 *  - driver      the document rendered as a page by a hidden, sandboxed window and printed silently through the
 *                installed Windows driver. The OS draws the text, so Marathi/Devanagari works.
 *
 * "Success" here means the bytes were accepted by the printer socket, or the page was accepted by the Windows spooler.
 * ESC/POS has no delivery receipt over these links, so nothing can prove paper came out; the UI says "sent".
 */
const NODE_NET = require('node:net');
const NODE_FS = require('node:fs');
const NODE_OS = require('node:os');
const NODE_PATH = require('node:path');
const NODE_CP = require('node:child_process');
const NODE_CRYPTO = require('node:crypto');

class TransportError extends Error {
  /**
   * @param {string} code NOT_CONFIGURED | PRINTER_NOT_FOUND | OFFLINE | ATTENTION | UNREACHABLE | TIMEOUT | WRITE_FAILED | REJECTED | UNSUPPORTED_PLATFORM | INTERRUPTED
   * @param {{ambiguous?: boolean}} [opts] ambiguous = some bytes may already have reached the printer
   */
  constructor(code, message, opts = {}) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
    this.ambiguous = opts.ambiguous === true;
  }
}

const DEFAULT_TIMEOUTS = { connectMs: 4000, writeMs: 8000, spoolerMs: 20000, driverMs: 30000 };

// Windows PRINTER_STATUS_* flags (winspool.h)
const PS = {
  PAUSED: 0x1, ERROR: 0x2, PENDING_DELETION: 0x4, PAPER_JAM: 0x8, PAPER_OUT: 0x10, PAPER_PROBLEM: 0x40, OFFLINE: 0x80,
  NOT_AVAILABLE: 0x1000, USER_INTERVENTION: 0x100000, DOOR_OPEN: 0x400000,
};

/** Decodes the status Windows reports for a queue. `blocking` problems make us refuse to send (and risk a duplicate later). */
function describeSpoolerStatus(status) {
  const s = Number(status) || 0;
  const problems = [];
  const add = (flag, text, blocking) => (s & flag ? problems.push({ text, blocking }) : null);
  add(PS.OFFLINE, 'The printer is offline (switched off, unplugged or not connected)', true);
  add(PS.NOT_AVAILABLE, 'The printer is not available', true);
  add(PS.PENDING_DELETION, 'The printer is being removed', true);
  add(PS.PAPER_OUT, 'The printer is out of paper', true);
  add(PS.PAPER_JAM, 'Paper jam', true);
  add(PS.DOOR_OPEN, 'The printer cover is open', true);
  add(PS.PAPER_PROBLEM, 'Paper problem', true);
  add(PS.ERROR, 'The printer reports an error', true);
  add(PS.USER_INTERVENTION, 'The printer needs attention', true);
  add(PS.PAUSED, 'The printer is paused in Windows', true);
  return { status: s, problems, blocked: problems.some((p) => p.blocking) };
}

// ------------------------------------------------------------------ the PowerShell RAW sender
const PS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$printer = $env:FC_PRINTER',
  '$file = $env:FC_FILE',
  "if (-not $printer -or -not $file) { [Console]::Error.WriteLine('ERR:INVALID:missing arguments'); exit 1 }",
  "Add-Type -TypeDefinition @'",
  'using System;',
  'using System.Runtime.InteropServices;',
  'public static class FcRawPrinter {',
  '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
  '  public struct DOC_INFO_1 { public string pDocName; public string pOutputFile; public string pDataType; }',
  '  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);',
  '  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);',
  '  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)] static extern int StartDocPrinter(IntPtr h, int level, ref DOC_INFO_1 di);',
  '  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);',
  '  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);',
  '  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);',
  '  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] b, int c, out int w);',
  '  public static string Send(string printer, byte[] data) {',
  '    IntPtr h;',
  '    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "ERR:OPEN:" + Marshal.GetLastWin32Error();',
  '    try {',
  '      DOC_INFO_1 di = new DOC_INFO_1(); di.pDocName = "FoodCourt print job"; di.pOutputFile = null; di.pDataType = "RAW";',
  '      if (StartDocPrinter(h, 1, ref di) == 0) return "ERR:START:" + Marshal.GetLastWin32Error();',
  '      string result = "OK";',
  '      try {',
  '        if (!StartPagePrinter(h)) return "ERR:START:" + Marshal.GetLastWin32Error();',
  '        int written; bool ok = WritePrinter(h, data, data.Length, out written);',
  '        int err = Marshal.GetLastWin32Error();',
  '        EndPagePrinter(h);',
  '        if (!ok || written != data.Length) result = "ERR:WRITE:" + err;',
  '      } finally { EndDocPrinter(h); }',
  '      return result;',
  '    } finally { ClosePrinter(h); }',
  '  }',
  '}',
  "'@",
  '$bytes = [System.IO.File]::ReadAllBytes($file)',
  '$res = [FcRawPrinter]::Send($printer, $bytes)',
  "if ($res -eq 'OK') { exit 0 }",
  '[Console]::Error.WriteLine($res)',
  'exit 2',
].join('\r\n');

/**
 * @param {object} deps
 * @param {() => Promise<Array<{name:string,status:number}>>} deps.listPrinters installed Windows printers
 * @param {() => object} deps.createPrintWindow hidden sandboxed window wrapper (loadHtml/contentHeight/print/destroy)
 * @param {string} deps.workDir folder for the helper script and temporary job files
 */
function createTransports(deps) {
  const net = deps.net || NODE_NET;
  const fs = deps.fs || NODE_FS;
  const path = deps.path || NODE_PATH;
  const spawn = deps.spawn || NODE_CP.spawn;
  const platform = deps.platform || process.platform;
  const timeouts = { ...DEFAULT_TIMEOUTS, ...(deps.timeouts || {}) };
  const workDir = deps.workDir || path.join(NODE_OS.tmpdir(), 'foodcourt-printing');

  // ---------------------------------------------------------------- network
  function describeSocketError(err, where) {
    if (err.code === 'ECONNREFUSED') return `The printer at ${where} refused the connection (is raw/9100 printing enabled on it?)`;
    if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') return `The printer at ${where} cannot be reached from this computer`;
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return `The printer name ${where} was not found on the network`;
    if (err.code === 'ECONNRESET' || err.code === 'EPIPE') return `The printer at ${where} closed the connection`;
    return `Could not reach the printer at ${where}: ${err.message}`;
  }

  function sendNetwork(target, buffer) {
    const where = `${target.host}:${target.port}`;
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let settled = false;
      let connected = false;
      let timer = null;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (err) reject(err);
        else resolve();
      };
      timer = setTimeout(
        () => done(new TransportError('UNREACHABLE', `The printer at ${where} did not answer - check it is on and on the same network`)),
        timeouts.connectMs,
      );
      socket.once('error', (err) => {
        // before the connection nothing was sent; afterwards some bytes may have been
        if (!connected) done(new TransportError('UNREACHABLE', describeSocketError(err, where)));
        else done(new TransportError('WRITE_FAILED', describeSocketError(err, where), { ambiguous: true }));
      });
      socket.once('close', () => {
        if (!connected) done(new TransportError('UNREACHABLE', `The printer at ${where} closed the connection`));
        else done();
      });
      socket.connect(target.port, target.host, () => {
        connected = true;
        clearTimeout(timer);
        timer = setTimeout(() => done(new TransportError('TIMEOUT', `The printer at ${where} stopped responding while printing`, { ambiguous: true })), timeouts.writeMs);
        // end() flushes and half-closes; resolution waits for 'close' so the bytes have left this computer
        socket.end(buffer);
      });
    });
  }

  async function probeNetwork(target) {
    try {
      await sendNetwork(target, Buffer.alloc(0));
      return { reachable: true, error: null };
    } catch (err) {
      return { reachable: false, error: err instanceof Error ? err.message : 'Unreachable' };
    }
  }

  // ---------------------------------------------------------------- Windows spooler
  async function findInstalled(name) {
    const list = await deps.listPrinters();
    return list.find((p) => p.name === name) || null;
  }

  /** Throws a TransportError when the queue is missing or Windows says it cannot print right now. */
  async function preflightSpooler(name) {
    const printer = await findInstalled(name);
    if (!printer) {
      throw new TransportError('PRINTER_NOT_FOUND', `The printer "${name}" is not installed in Windows (removed, renamed or unplugged USB printers can disappear)`);
    }
    const d = describeSpoolerStatus(printer.status);
    if (d.blocked) {
      const text = d.problems.filter((p) => p.blocking).map((p) => p.text).join('; ');
      throw new TransportError(/offline|not available|removed/i.test(text) ? 'OFFLINE' : 'ATTENTION', `${text} ("${name}")`);
    }
    return d;
  }

  function ensureScript() {
    fs.mkdirSync(workDir, { recursive: true });
    const file = path.join(workDir, 'rawprint.ps1');
    let current = null;
    try {
      current = fs.readFileSync(file, 'utf8');
    } catch {
      // not there yet
    }
    if (current !== PS_SCRIPT) fs.writeFileSync(file, PS_SCRIPT, 'utf8');
    return file;
  }

  async function sendSpoolerRaw(name, buffer) {
    if (platform !== 'win32') throw new TransportError('UNSUPPORTED_PLATFORM', 'Printing through a Windows printer queue is only available on Windows');
    await preflightSpooler(name);
    const script = ensureScript();
    const jobFile = path.join(workDir, `job-${NODE_CRYPTO.randomBytes(8).toString('hex')}.bin`);
    fs.writeFileSync(jobFile, buffer);
    try {
      await new Promise((resolve, reject) => {
        // The printer name and file travel in environment variables: nothing from the renderer is ever spliced into a command line.
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
          env: { ...process.env, FC_PRINTER: name, FC_FILE: jobFile },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let err = '';
        let finished = false;
        const end = (e) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          if (e) reject(e);
          else resolve();
        };
        const timer = setTimeout(() => {
          try {
            child.kill();
          } catch {
            // already gone
          }
          end(new TransportError('TIMEOUT', `Windows did not accept the print job for "${name}" in time`, { ambiguous: true }));
        }, timeouts.spoolerMs);
        child.stderr?.on('data', (d) => (err += String(d)));
        child.on('error', (e) => end(new TransportError('WRITE_FAILED', `Could not start the Windows print helper: ${e.message}`)));
        child.on('close', (code) => {
          if (code === 0) return end();
          const m = /ERR:(OPEN|START|WRITE|INVALID):?(\d+)?/.exec(err);
          const kind = m ? m[1] : 'UNKNOWN';
          const win32 = m && m[2] ? Number(m[2]) : 0;
          if (kind === 'OPEN') {
            return end(new TransportError(win32 === 1801 ? 'PRINTER_NOT_FOUND' : 'OFFLINE', `Windows could not open the printer "${name}" (error ${win32 || 'unknown'})`));
          }
          if (kind === 'START') return end(new TransportError('REJECTED', `Windows refused to start a print job on "${name}" (error ${win32})`));
          if (kind === 'WRITE') return end(new TransportError('WRITE_FAILED', `Writing to "${name}" failed (error ${win32})`, { ambiguous: true }));
          return end(new TransportError('WRITE_FAILED', `The Windows print helper failed${err ? `: ${err.trim().slice(0, 200)}` : ''}`, { ambiguous: true }));
        });
      });
    } finally {
      try {
        fs.unlinkSync(jobFile);
      } catch {
        // already removed
      }
    }
  }

  // ---------------------------------------------------------------- Windows driver (rendered page)
  async function printViaDriver(name, html, paperWidthMm) {
    await preflightSpooler(name);
    const win = deps.createPrintWindow();
    try {
      await win.loadHtml(html);
      const heightPx = Math.max(50, Math.min(20000, Math.ceil(await win.contentHeight())));
      const heightMicrons = Math.ceil(heightPx * 264.583) + 3000; // CSS px -> microns, plus a little tail
      const result = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ success: false, reason: 'timeout' }), timeouts.driverMs);
        win.print({ deviceName: name, widthMicrons: paperWidthMm * 1000, heightMicrons }, (success, reason) => {
          clearTimeout(timer);
          resolve({ success, reason });
        });
      });
      if (!result.success) {
        if (result.reason === 'timeout') throw new TransportError('TIMEOUT', `Windows did not accept the page for "${name}" in time`, { ambiguous: true });
        throw new TransportError('REJECTED', `Windows rejected the print job for "${name}"${result.reason ? `: ${result.reason}` : ''}`);
      }
    } finally {
      try {
        win.destroy();
      } catch {
        // already closed
      }
    }
  }

  // ---------------------------------------------------------------- status (never throws)
  async function status(profile) {
    const checkedAt = new Date().toISOString();
    try {
      if (profile.transport === 'dialog') return { state: 'unknown', message: 'Prints through the Windows print dialog; status is shown there.', checkedAt };
      if (profile.transport === 'none') return { state: 'unconfigured', message: 'No printer selected.', checkedAt };
      if (profile.transport === 'network') {
        if (!profile.host) return { state: 'unconfigured', message: 'No printer address entered.', checkedAt };
        const p = await probeNetwork({ host: profile.host, port: profile.port });
        return p.reachable
          ? { state: 'ready', message: `Reachable at ${profile.host}:${profile.port}. This only proves something is listening; it does not prove the printer has paper.`, checkedAt }
          : { state: 'offline', message: p.error, checkedAt };
      }
      if (!profile.printerName) return { state: 'unconfigured', message: 'No Windows printer selected.', checkedAt };
      const printer = await findInstalled(profile.printerName);
      if (!printer) return { state: 'not-found', message: `"${profile.printerName}" is not installed in Windows.`, checkedAt };
      const d = describeSpoolerStatus(printer.status);
      if (d.blocked) return { state: 'offline', message: d.problems.map((p) => p.text).join('; '), checkedAt };
      return {
        state: 'ready',
        message: 'Installed in Windows and not reporting a problem. Windows often cannot tell that a USB printer is switched off until a job is sent.',
        checkedAt,
      };
    } catch (err) {
      return { state: 'unknown', message: err instanceof Error ? err.message : 'Status check failed', checkedAt };
    }
  }

  return { sendNetwork, probeNetwork, sendSpoolerRaw, printViaDriver, preflightSpooler, status, PS_SCRIPT };
}

module.exports = { createTransports, TransportError, describeSpoolerStatus, DEFAULT_TIMEOUTS, PS_SCRIPT };
