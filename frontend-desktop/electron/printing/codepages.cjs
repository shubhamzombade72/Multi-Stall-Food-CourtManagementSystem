'use strict';
/**
 * Single-byte code pages for ESC/POS text printing: bytes 0x80-0xFF of each page (0x00-0x7F is ASCII in all of them).
 * Generated from the standard IBM/Microsoft code page definitions (Python codecs cp437/cp850/cp858/cp1252);
 * U+FFFD marks a byte the page leaves undefined.
 *
 * `escposTable` is the ESC t n selector in the Epson ESC/POS reference (0 = PC437, 2 = PC850, 16 = WPC1252,
 * 19 = PC858). Clone printers sometimes number pages differently, so a test print on the real unit is required.
 *
 * Marathi/Devanagari is intentionally absent: no common thermal-printer code page carries it. Documents containing
 * it must go through the Windows-driver transport (rendered as graphics by the OS), see printing/escpos.cjs.
 */
const CODEPAGES = {
  "CP437": {
    "escposTable": 0,
    "high": "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ "
  },
  "CP850": {
    "escposTable": 2,
    "high": "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ "
  },
  "CP858": {
    "escposTable": 19,
    "high": "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈ€ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ "
  },
  "CP1252": {
    "escposTable": 16,
    "high": "€�‚ƒ„…†‡ˆ‰Š‹Œ�Ž��‘’“”•–—˜™š›œ�žŸ ¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ"
  }
};

module.exports = { CODEPAGES, CODEPAGE_NAMES: Object.keys(CODEPAGES) };
