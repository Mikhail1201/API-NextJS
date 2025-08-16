'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { auth } from '@/app/firebase/config';
import { useAuthState } from 'react-firebase-hooks/auth';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

// Define a type for your report data
interface Report {
  id: string;
  request?: string;
  number?: string;
  [key: string]: unknown;
}

export default function DeleteReportPage() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedReportId, setSelectedReportId] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [user, loading] = useAuthState(auth);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [roleChecked, setRoleChecked] = useState(false);
  const db = getFirestore();

  // Check user role
  useEffect(() => {
    const checkRole = async () => {
      if (!user) return;
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userRole = userDoc.exists() ? userDoc.data().role : null;
      if (!userRole) {
        await signOut(auth);
        router.push('/login');
        return;
      }
      setRoleChecked(true);
    };
    if (!loading && user) checkRole();
  }, [user, loading, db, router]);

  useEffect(() => {
    const fetchReports = async () => {
      const snapshot = await getDocs(collection(db, 'reports'));
      const reportList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Report));
      setReports(reportList);
    };
    if (!loading && user && roleChecked) fetchReports();
  }, [loading, user, db, roleChecked]);

  const handleDelete = async () => {
    if (!selectedReportId) return;
    const res = await fetch('/api/admin-delete-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportId: selectedReportId,
        userId: user?.uid,
        userEmail: user?.email,
      }),
    });
    if (res.ok) {
      setReports(reports.filter(r => r.id !== selectedReportId));
      setShowConfirm(false);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    }
  };

  // Don't render page content until role is checked and valid
  if (loading || !roleChecked) return null;

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
        <h1 className="text-2xl font-bold text-center mb-4 text-gray-800">Eliminar Reporte</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setShowConfirm(true);
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="reportSelect" className="block text-sm font-medium text-gray-700 mb-1">Seleccione reporte</label>
            <select
              id="reportSelect"
              value={selectedReportId}
              onChange={e => setSelectedReportId(e.target.value)}
              className="w-full p-3 rounded-lg border border-gray-300 text-gray-900 bg-white"
              required
            >
              <option value="" disabled>Seleccione un reporte</option>
              {reports.map(r => (
                <option key={r.id} value={r.id}>{r.request || r.number || r.id}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="cursor-pointer w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg transition duration-200"
          >
            Eliminar Reporte
          </button>
        </form>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-50">
          <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-sm">
            <h2 className="text-lg font-semibold mb-2 text-black">Confirmar Eliminación</h2>
            <p className="text-sm text-gray-700 mb-4">
              ¿Está seguro que desea eliminar este reporte?
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirme su contraseña
            </label>
            <input
              type="password"
              placeholder="Ingrese su contraseña"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full p-2 mb-2 border border-gray-300 rounded text-black"
            />
            {passwordError && (
              <div className="text-red-600 text-sm mb-2">{passwordError}</div>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowConfirm(false);
                  setConfirmPassword('');
                  setPasswordError('');
                }}
                className="cursor-pointer px-4 py-2 rounded bg-gray-300 hover:bg-gray-400 text-gray-800 transition"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setPasswordError('');
                  if (!user || !user.email) {
                    setPasswordError('Usuario no autenticado o falta el correo.');
                    return;
                  }
                  try {
                    await signInWithEmailAndPassword(auth, user.email, confirmPassword);
                    setConfirmPassword('');
                    handleDelete();
                  } catch {
                    setPasswordError('Contraseña incorrecta. Inténtelo de nuevo.');
                  }
                }}
                className="cursor-pointer px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white font-semibold transition"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccess && (
        <div className="fixed bottom-4 right-4 bg-green-500 text-white p-4 rounded-lg shadow-lg flex items-center gap-2 z-50 animate-fadeInDown">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.586-6.586a2 2 0 00-2.828 0l-10 10a2 2 0 000 2.828l3.172 3.172a2 2 0 002.828 0l10-10a2 2 0 000-2.828z" />
          </svg>
          <span>¡Reporte eliminado exitosamente!</span>
        </div>
      )}

      <style jsx global>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeInDown {
          animation: fadeInDown 0.8s ease forwards;
          opacity: 1 !important;
        }
      `}</style>
    </div>
  );
}
