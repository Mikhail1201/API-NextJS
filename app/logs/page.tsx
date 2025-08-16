'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, notFound } from 'next/navigation';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { auth } from '@/app/firebase/config';
import { useAuthState } from 'react-firebase-hooks/auth';

// Define a type for your log data
interface Log {
  id: string;
  performedBy?: string;
  action?: string;
  details?: string;
  timestamp?: { seconds: number };
  [key: string]: unknown;
}

export default function LogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<Log[]>([]);
  const [user, loading] = useAuthState(auth);
  const [roleChecked, setRoleChecked] = useState(false);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedUser, setSelectedUser] = useState<string>('all');
  const [selectedAction, setSelectedAction] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const logsPerPage = 5;
  const db = getFirestore();

  useEffect(() => {
    const checkRoleAndFetchLogs = async () => {
      if (!user) return;
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userRole = userDoc.exists() ? userDoc.data().role : null;
      if (userRole !== 'superadmin') {
        notFound();
        return;
      }
      setRoleChecked(true);
      const logsSnapshot = await getDocs(collection(db, 'logs'));
      const logsList = logsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Log));
      setLogs(logsList);
    };
    if (!loading && user) {
      checkRoleAndFetchLogs();
    }
  }, [user, loading, db]);

  const uniqueUsers = useMemo(
    () => Array.from(new Set(logs.map(log => log.performedBy).filter(Boolean))),
    [logs]
  );
  const uniqueActions = useMemo(
    () => Array.from(new Set(logs.map(log => log.action).filter(Boolean))),
    [logs]
  );

  const filteredLogs = useMemo(() => {
    let filtered = logs;
    if (selectedUser !== 'all') {
      filtered = filtered.filter(log => log.performedBy === selectedUser);
    }
    if (selectedAction !== 'all') {
      filtered = filtered.filter(log => log.action === selectedAction);
    }
    filtered = filtered.slice().sort((a, b) => {
      const aTime = a.timestamp?.seconds || 0;
      const bTime = b.timestamp?.seconds || 0;
      return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
    });
    return filtered;
  }, [logs, selectedUser, selectedAction, sortOrder]);

  const totalPages = Math.ceil(filteredLogs.length / logsPerPage);
  const paginatedLogs = filteredLogs.slice(
    (currentPage - 1) * logsPerPage,
    currentPage * logsPerPage
  );

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [filteredLogs, totalPages, currentPage]);

  if (loading || !roleChecked) return null;

  return (
    <div className="relative h-screen flex flex-col items-center justify-between px-4 py-16 overflow-hidden">
      <button
        onClick={() => router.push('/')}
        className="absolute top-4 left-4 z-20 bg-white/90 hover:bg-white text-blue-600 p-3 rounded-full shadow-md transition cursor-pointer"
        aria-label="Volver al inicio"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div className="text-center text-white z-10 animate-fadeInDown">
        <h1 className="text-3xl sm:text-4xl font-bold">Registros</h1>
        <p className="text-white/80 text-sm">Todas las acciones recientes del sistema</p>
      </div>

      <div className="flex flex-wrap gap-4 z-10 w-full max-w-4xl justify-center mt-6 mb-2">
        <button
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold transition"
        >
          Ordenar por Fecha: {sortOrder === 'asc' ? 'Más antiguos' : 'Más recientes'}
        </button>
        <select
          value={selectedUser}
          onChange={e => setSelectedUser(e.target.value)}
          className="cursor-pointer p-2 rounded-lg border border-gray-300 bg-white text-gray-800 appearance-none"
        >
          <option value="all">Todos los Usuarios</option>
          {uniqueUsers.map(user => (
            <option key={user as string} value={user as string}>{user as string}</option>
          ))}
        </select>
        <select
          value={selectedAction}
          onChange={e => setSelectedAction(e.target.value)}
          className="cursor-pointer p-2 rounded-lg border border-gray-300 bg-white text-gray-800 appearance-none"
        >
          <option value="all">Todas las Acciones</option>
          {uniqueActions.map(action => (
            <option key={action as string} value={action as string}>{action as string}</option>
          ))}
        </select>
      </div>

      <div className="z-10 bg-white w-full max-w-4xl rounded-xl shadow-xl p-4 h-[500px] flex flex-col justify-between">
        <div className="overflow-auto">
          <table className="w-full table-auto border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-700 text-sm">
                <th className="px-2 py-1 text-left">Usuario</th>
                <th className="px-2 py-1 text-left">Acción</th>
                <th className="px-2 py-1 text-left">Descripción</th>
                <th className="px-2 py-1 text-left">Fecha y Hora</th>
              </tr>
            </thead>
            <tbody>
              {paginatedLogs.map(log => (
                <tr key={log.id} className="border-t border-gray-200 text-sm text-gray-800 hover:bg-gray-50">
                  <td className="px-2 py-1">{log.performedBy || '-'}</td>
                  <td className="px-2 py-1">{log.action}</td>
                  <td className="px-2 py-1">{log.details}</td>
                  <td className="px-2 py-1">
                    {log.timestamp?.seconds
                      ? new Date(log.timestamp.seconds * 1000).toLocaleString('es-CO')
                      : '-'}
                  </td>
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
                      className={`px-3 py-1 rounded cursor-pointer text-black ${
                        currentPage === page
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

      <style jsx global>{`
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
