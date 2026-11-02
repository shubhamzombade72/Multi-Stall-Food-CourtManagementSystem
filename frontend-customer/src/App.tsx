import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QrMenuPage } from './pages/QrMenuPage';
import { OrderTrackPage } from './pages/OrderTrackPage';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<QrMenuPage />} />
        <Route path="/table/:qrToken" element={<QrMenuPage />} />
        <Route path="/order/:trackingToken" element={<OrderTrackPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

