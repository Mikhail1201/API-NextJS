'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/app/firebase/config';
import { useAuthState } from 'react-firebase-hooks/auth';
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';

// Define a type for your report data
interface Report {
  id: string;
  request?: string;
  number?: string;
  reportdate?: { seconds: number };
  description?: string;
  pointofsell?: string;
  quotation?: string;
  deliverycertificate?: string;
  state?: string;
  bill?: string;
  [key: string]: unknown;
}

export default function ExportReportsPage() {
  const router = useRouter();
  const [user, loading] = useAuthState(auth);

  // Set default date to today in YYYY-MM-DD format
  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(todayStr);

  const exportToExcel = (data: Report[], fileName: string) => {
    const worksheet = XLSX.utils.json_to_sheet(
      data.map(r => ({
        ID: r.id,
        Request: r.request || '',
        Number: r.number || '',
        'Report Date': r.reportdate?.seconds
          ? new Date(r.reportdate.seconds * 1000).toLocaleString()
          : r.reportdate || '',
        Description: r.description || '',
        'Point of Sell': r.pointofsell || '',
        Quotation: r.quotation || '',
        'Delivery Certificate': r.deliverycertificate || '',
        State: r.state || '',
        Bill: r.bill || ''
      }))
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reports');
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/octet-stream' });
    saveAs(blob, `${fileName}.xlsx`);
  };

  const fetchReportsFromAPI = async (onlyThatDay: boolean): Promise<Report[]> => {
    const res = await fetch('/api/admin-export-reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedDate,
        onlyThatDay,
        userId: user?.uid,
        userEmail: user?.email,
      }),
    });
    const data = await res.json();
    return data.success ? data.reports : [];
  };

  const handleExport = async (onlyThatDay: boolean) => {
    if (!selectedDate) return;
    const reports = await fetchReportsFromAPI(onlyThatDay);
    exportToExcel(
      reports,
      onlyThatDay ? `reports_on_${selectedDate}` : `reports_until_${selectedDate}`
    );
  };

  if (loading) return null;

  return (
    <div className="relative h-screen flex flex-col items-center justify-center px-4 overflow-hidden">
      <button
        onClick={() => router.push('/')}
        className="absolute top-4 left-4 z-20 bg-white/90 hover:bg-white text-blue-600 p-3 rounded-full shadow-md transition cursor-pointer"
        aria-label="Volver al inicio"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div className="z-10 bg-white w-full max-w-md p-6 rounded-2xl shadow-xl">
        <h1 className="text-2xl font-bold text-center mb-4 text-gray-800">Exportar Reportes</h1>

        <label className="block text-sm font-medium text-gray-700 mb-1">Seleccione Fecha</label>
        <input
          type="date"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          className="w-full mb-4 p-3 rounded-lg border border-gray-300 text-gray-900"
          required
        />

        <button
          onClick={() => handleExport(false)}
          className="cursor-pointer w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg mb-2"
        >
          Exportar todos los reportes hasta la fecha seleccionada
        </button>

        <button
          onClick={() => handleExport(true)}
          className="cursor-pointer w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 rounded-lg"
        >
          Exportar solo los reportes de la fecha seleccionada
        </button>
      </div>
    </div>
  );
}
