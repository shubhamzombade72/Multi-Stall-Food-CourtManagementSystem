import React, { useEffect, useState } from 'react';
import { PackageCheck } from 'lucide-react';
import { apiClient } from '../api/client';
import { apiError, daysAgo, isoDate } from '../lib/format';
import { Card, EmptyState, ErrorBanner, Loading, PageHeader, Pagination, compactInputClass } from '../components/ui';
import { MovementTable } from './StorePage';

/** Read-only for a stall manager: what the central store issued to, or took back from, their own stall. */
export const StoreReceivedPage: React.FC = () => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(isoDate());
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    apiClient
      .get('/store/movements', { params: { date_from: from, date_to: to, page, per_page: 25 } })
      .then((r) => {
        const d = r.data.data;
        setRows(d.data);
        setLastPage(d.last_page);
        setTotal(d.total);
        setError(null);
      })
      .catch((err) => {
        setRows([]);
        setError(apiError(err, 'Failed to load received stock'));
      });
  }, [from, to, page]);

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Stock Received"
        subtitle="What the central store gave to your stall."
        icon={PackageCheck}
        actions={
          <>
            <input aria-label="From date" type="date" className={compactInputClass} value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
            <input aria-label="To date" type="date" className={compactInputClass} value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </>
        }
      />
      <ErrorBanner message={error} />
      <Card>
        {rows === null ? <Loading /> : rows.length === 0 ? <EmptyState title="Nothing received in these dates" /> : <MovementTable rows={rows} stallView />}
        <Pagination page={page} lastPage={lastPage} total={total} onPage={setPage} />
      </Card>
    </div>
  );
};
