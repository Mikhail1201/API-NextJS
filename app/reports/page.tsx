'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { auth } from '@/app/firebase/config';
import { useAuthState } from 'react-firebase-hooks/auth';
import { signOut } from 'firebase/auth';

export default function ReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<any[]>([]);
  const [user, loading] = useAuthState(auth);
  const [roleChecked, setRoleChecked] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedPoint, setSelectedPoint] = useState('all');
  const [selectedState, setSelectedState] = useState('all');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const reportsPerPage = 10;
  const db = getFirestore();
  const [selectedReport, setSelectedReport] = useState<any | null>(null);
  const [editReport, setEditReport] = useState<any | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const checkRoleAndFetchReports = async () => {
      if (!user) return;
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userRole = userDoc.exists() ? userDoc.data().role : null;
      if (!userRole) {
        await signOut(auth);
        router.push('/login');
        return;
      }
      setRoleChecked(true);
      const reportsSnapshot = await getDocs(collection(db, 'reports'));
      const reportsList = reportsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setReports(reportsList);
    };
    if (!loading && user) {
      checkRoleAndFetchReports();
    }
  }, [user, loading, db, router]);

  const uniquePoints = useMemo(
    () => Array.from(new Set(reports.map(r => r.pointofsell).filter(Boolean))),
    [reports]
  );
  const uniqueStates = useMemo(
    () => Array.from(new Set(reports.map(r => r.state).filter(Boolean))),
    [reports]
  );

  const filteredReports = useMemo(() => {
    let filtered = reports;
    if (selectedPoint !== 'all') {
      filtered = filtered.filter(r => r.pointofsell === selectedPoint);
    }
    if (selectedState !== 'all') {
      filtered = filtered.filter(r => r.state === selectedState);
    }
    return filtered.slice().sort((a, b) => {
      // Handle Firestore Timestamp or string date
      const getDateValue = (val: any) => {
        if (!val) return 0;
        if (typeof val === 'string') return new Date(val).getTime();
        if (val.seconds) return val.seconds * 1000;
        return 0;
      };
      const aTime = getDateValue(a.reportdate);
      const bTime = getDateValue(b.reportdate);
      return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
    });
  }, [reports, selectedPoint, selectedState, sortOrder]);

  const totalPages = Math.ceil(filteredReports.length / reportsPerPage);
  const paginatedReports = useMemo(() => {
    return filteredReports.slice((currentPage - 1) * reportsPerPage, currentPage * reportsPerPage);
  }, [filteredReports, currentPage]);

  if (loading || !roleChecked) return null;

  return (
    <div className="relative h-screen flex flex-col items-center bg-gradient-to-br from-[#1a0a2e] via-[#0d324d] to-[#1d2671] px-4 py-8 overflow-hidden">
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute rounded-full bg-white/10 w-[12vw] h-[12vw] top-[10%] left-[10%] animate-[float_20s_linear_infinite]" />
        <div className="absolute rounded-full bg-white/10 w-[10vw] h-[10vw] top-[70%] left-[85%] animate-[float_15s_linear_infinite] delay-[-3s]" />
        <div className="absolute rounded-full bg-white/10 w-[7vw] h-[7vw] top-[25%] left-[80%] animate-[float_12s_linear_infinite] delay-[-5s]" />
      </div>

      <button
        onClick={() => router.push('/')}
        className="absolute top-4 left-4 z-20 bg-white/90 hover:bg-white text-blue-600 p-3 rounded-full shadow-md transition cursor-pointer"
        aria-label="Go back to homepage"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div className="text-center text-white z-10 animate-fadeInDown">
        <h1 className="text-3xl sm:text-4xl font-bold">Reportes</h1>
        <p className="text-white/80 text-sm">Todos los reportes</p>
      </div>

      <div className="flex flex-wrap gap-4 z-10 w-full max-w-6xl justify-start mt-6 mb-2">
        <button
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          className="cursor-pointer bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold transition text-center h-auto"
          style={{ height: 'auto', minHeight: 'unset' }}
        >
          Ordenar por Fecha: {sortOrder === 'asc' ? 'Más antiguos' : 'Más recientes'}
        </button>

        <select
          value={selectedPoint}
          onChange={e => setSelectedPoint(e.target.value)}
          className="cursor-pointer p-2 rounded-lg border border-gray-300 bg-white text-gray-800 appearance-none h-auto"
          style={{ height: 'auto', minHeight: 'unset' }}
        >
          <option value="all">Todos los Puntos de Venta</option>
          {uniquePoints.map(point => (
            <option key={point} value={point}>{point}</option>
          ))}
        </select>

        <select
          value={selectedState}
          onChange={e => setSelectedState(e.target.value)}
          className="cursor-pointer p-2 rounded-lg border border-gray-300 bg-white text-gray-800 appearance-none h-auto"
          style={{ height: 'auto', minHeight: 'unset' }}
        >
          <option value="all">Todos los Estados</option>
          {uniqueStates.map(state => (
            <option key={state} value={state}>{state}</option>
          ))}
        </select>
      </div>

      <div className="z-10 bg-white w-full max-w-6xl rounded-xl shadow-xl p-4 mt-2 h-[420px] flex flex-col justify-between">
        <div className="flex-grow overflow-auto">
          <table className="w-full table-auto border-collapse text-sm text-gray-800">
            <thead className="bg-gray-100 text-gray-700">
              <tr>
                <th className="px-2 py-1 text-center">Solicitud</th>
                <th className="px-2 py-1 text-center">Número</th>
                <th className="px-2 py-1 text-center">Fecha de Reporte</th>
                <th className="px-2 py-1 text-center">Descripción</th>
                <th className="px-2 py-1 text-center">Punto de Venta</th>
                <th className="px-2 py-1 text-center">Cotización</th>
                <th className="px-2 py-1 text-center">Certificado de Entrega</th>
                <th className="px-2 py-1 text-center">Estado</th>
                <th className="px-2 py-1 text-center">Factura</th>
              </tr>
            </thead>
            <tbody>
              {paginatedReports.map(report => (
                <tr
                  key={report.id}
                  className="border-t border-gray-200 hover:bg-blue-100 cursor-pointer transition"
                  onClick={() => {
                    setSelectedReport(report);
                    setEditReport({ ...report }); // clone for editing
                    setShowModal(true);
                  }}
                >
                  <td className="px-2 py-1">{report.request || '-'}</td>
                  <td className="px-2 py-1">{report.number || '-'}</td>
                  <td className="px-2 py-1">{report.reportdate || '-'}</td>
                  <td className="px-2 py-1">{report.description || '-'}</td>
                  <td className="px-2 py-1">{report.pointofsell || '-'}</td>
                  <td className="px-2 py-1">{report.quotation || '-'}</td>
                  <td className="px-2 py-1">{report.deliverycertificate || '-'}</td>
                  <td className="px-2 py-1">{report.state || '-'}</td>
                  <td className="px-2 py-1">{report.bill || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center mt-4 gap-1 flex-wrap">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(currentPage - 1)}
              className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-50 text-black cursor-pointer"
            >
              Anterior
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(page =>
                page === 1 ||
                page === totalPages ||
                Math.abs(page - currentPage) <= 2
              )
              .map((page, idx, arr) => {
                const prev = arr[idx - 1];
                const showEllipsis = prev && page - prev > 1;

                return (
                  <span key={page} className="flex items-center">
                    {showEllipsis && <span className="px-1">...</span>}
                    <button
                      onClick={() => setCurrentPage(page)}
                      className={`px-3 py-1 rounded cursor-pointer text-black ${currentPage === page
                          ? 'bg-blue-600 text-white font-bold'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                      {page}
                    </button>
                  </span>
                );
              })}

            <button
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(currentPage + 1)}
              className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-50 text-black cursor-pointer"
            >
              Siguiente
            </button>

            <button
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(totalPages)}
              className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-50 text-black cursor-pointer"
            >
              Última
            </button>
          </div>
        )}
      </div>

      {showModal && selectedReport && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-lg w-[90%] max-w-3xl p-6">
            <h2 className="text-xl font-semibold mb-4 text-black">Detalles del Reporte</h2>
            <div className="grid grid-cols-2 gap-4 text-black">
              <div>
                <strong>Solicitud:</strong> {selectedReport.request || '-'}
              </div>
              <div>
                <strong>Número:</strong> {selectedReport.number || '-'}
              </div>
              <div>
                <strong>Fecha de Reporte:</strong> {selectedReport.reportdate || '-'}
              </div>
              <div>
                <strong>Descripción:</strong> {selectedReport.description || '-'}
              </div>
              <div>
                <strong>Punto de Venta:</strong> {selectedReport.pointofsell || '-'}
              </div>
              <div>
                <strong>Cotización:</strong> {selectedReport.quotation || '-'}
              </div>
              <div>
                <strong>Certificado de Entrega:</strong> {selectedReport.deliverycertificate || '-'}
              </div>
              <div>
                <strong>Estado:</strong> {selectedReport.state || '-'}
              </div>
              <div>
                <strong>Factura:</strong> {selectedReport.bill || '-'}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="cursor-pointer px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 transition text-black"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && selectedReport && editReport && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-lg w-[90%] max-w-3xl p-6">
            <h2 className="text-xl font-semibold mb-4 text-black">Editar Reporte</h2>
            <div className="grid grid-cols-2 gap-4 text-black">
              <div>
                <strong>Solicitud:</strong>
                <input
                  className="w-full border rounded p-1 mt-1"
                  value={editReport.request || ''}
                  onChange={e => setEditReport({ ...editReport, request: e.target.value })}
                />
              </div>
              <div>
                <strong>Número:</strong>
                <input
                  className="w-full border rounded p-1 mt-1"
                  value={editReport.number || ''}
                  onChange={e => setEditReport({ ...editReport, number: e.target.value })}
                />
              </div>
              <div>
                <strong>Fecha de Reporte:</strong>
                <input
                  type="date"
                  className="w-full border rounded p-1 mt-1"
                  value={editReport.reportdate || ''}
                  onChange={e => setEditReport({ ...editReport, reportdate: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <strong>Descripción:</strong>
                <textarea
                  className="w-full border rounded p-1 mt-1"
                  value={editReport.description || ''}
                  onChange={e => setEditReport({ ...editReport, description: e.target.value })}
                />
              </div>
              <div>
                <strong>Punto de Venta:</strong>
                <input
                  className="w-full border rounded p-1 mt-1"
                  value={editReport.pointofsell || ''}
                  onChange={e => setEditReport({ ...editReport, pointofsell: e.target.value })}
                />
              </div>
              <div>
                <strong>Cotización:</strong>
                <input
                  className="w-full border rounded p-1 mt-1"
                  value={editReport.quotation || ''}
                  onChange={e => setEditReport({ ...editReport, quotation: e.target.value })}
                />
              </div>
              <div>
                <strong>Certificado de Entrega:</strong>
                <input
                  className="w-full border rounded p-1 mt-1"
                  value={editReport.deliverycertificate || ''}
                  onChange={e => setEditReport({ ...editReport, deliverycertificate: e.target.value })}
                />
              </div>
              <div>
                <strong>Estado:</strong>
                <input
                  className="w-full border rounded p-1 mt-1"
                  value={editReport.state || ''}
                  onChange={e => setEditReport({ ...editReport, state: e.target.value })}
                />
              </div>
              <div>
                <strong>Factura:</strong>
                <input
                  className="w-full border rounded p-1 mt-1"
                  value={editReport.bill || ''}
                  onChange={e => setEditReport({ ...editReport, bill: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="cursor-pointer px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 transition text-black"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  const res = await fetch('/api/admin-update-report', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      ...editReport,
                      userId: user?.uid,
                      userEmail: user?.email,
                    }),
                  });
                  if (res.ok) {
                    setShowModal(false);

                    // Show success div with countdown
                    let seconds = 2;
                    const successDiv = document.createElement('div');
                    successDiv.className =
                      'fixed bottom-4 right-4 bg-green-500 text-white p-4 rounded-lg shadow-lg flex items-center gap-2 opacity-0 transition-opacity duration-500 z-50';
                    successDiv.innerHTML = `
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.586-6.586a2 2 0 00-2.828 0l-10 10a2 2 0 000 2.828l3.172 3.172a2 2 0 002.828 0l10-10a2 2 0 000-2.828z"></path>
      </svg>
      <span>¡Reporte actualizado exitosamente! Actualizando en <span id="countdown">${seconds}</span>...</span>
    `;
                    document.body.appendChild(successDiv);
                    setTimeout(() => successDiv.classList.add('opacity-100'), 10);

                    // Countdown logic
                    const countdownInterval = setInterval(() => {
                      seconds -= 1;
                      const countdownSpan = successDiv.querySelector('#countdown');
                      if (countdownSpan) countdownSpan.textContent = String(seconds);
                      if (seconds <= 0) {
                        clearInterval(countdownInterval);
                        successDiv.classList.remove('opacity-100');
                        setTimeout(() => {
                          successDiv.remove();
                          window.location.reload();
                        }, 500);
                      }
                    }, 1000);
                  }
                }}
                className="cursor-pointer px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 transition text-white"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes float {
          0% { transform: translate(0, 0) rotate(0deg); }
          50% { transform: translate(15px, 25px) rotate(180deg); }
          100% { transform: translate(0, 0) rotate(360deg); }
        }
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeInDown {
          animation: fadeInDown 0.8s ease forwards;
        }
      `}</style>
    </div>
  );
}
