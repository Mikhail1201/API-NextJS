'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getFirestore, collection, getDoc, doc, query, where, getDocs } from 'firebase/firestore';
import { auth } from '@/app/firebase/config';
import { useAuthState } from 'react-firebase-hooks/auth';
import * as XLSX from 'xlsx';

export default function ImportReportsPage() {
  const router = useRouter();
  const [user, loading] = useAuthState(auth);
  const [file, setFile] = useState<File | null>(null);
  const [success, setSuccess] = useState(false);
  const [roleChecked, setRoleChecked] = useState(false);
  const [skippedReports, setSkippedReports] = useState<string[]>([]);
  const [showSkippedPopup, setShowSkippedPopup] = useState(false);
  const [unknownPoints, setUnknownPoints] = useState<string[]>([]);
  const [currentPoint, setCurrentPoint] = useState<string | null>(null);
  const [pendingReports, setPendingReports] = useState<any[]>([]);
  const [pendingIndex, setPendingIndex] = useState(0);
  const db = getFirestore();

  // Check for superadmin role
  useEffect(() => {
    const checkRole = async () => {
      if (!user) return;
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userRole = userDoc.exists() ? userDoc.data().role : null;
      if (userRole !== 'superadmin') {
        router.push('/'); // redirect if not superadmin
        return;
      }
      setRoleChecked(true);
    };
    if (!loading && user) checkRole();
  }, [user, loading, db, router]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploaded = e.target.files?.[0];
    if (uploaded) setFile(uploaded);
    setSkippedReports([]);        // Clear skipped reports
    setShowSkippedPopup(false);   // Hide popup
  };

  const handleImport = async () => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      if (!e.target) return;
      // Parse Excel on frontend to get points of sell
      const data = new Uint8Array(e.target.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData: any[] = XLSX.utils.sheet_to_json(sheet);

      // Helper function for normalization
      const normalizePoint = (str: string) =>
        (str || '').replace(/\s+/g, '').toUpperCase();

      // Fetch all existing points of sell from Firestore
      const posSnapshot = await getDocs(collection(db, 'pointsofsell'));
      const existingPoints = posSnapshot.docs.map(doc => normalizePoint(doc.data().name));

      // Get all unique points of sell from the file
      const pointsInFile = Array.from(
        new Set(jsonData.map(r => normalizePoint(r.pointofsell)).filter(Boolean))
      );

      // Find unknown points of sell
      const unknown = pointsInFile.filter(p => !existingPoints.includes(p));
      if (unknown.length > 0) {
        setUnknownPoints(unknown);
        setCurrentPoint(unknown[0]);
        setPendingReports(jsonData);
        setPendingIndex(0);
        return; // Wait for user input before proceeding
      }

      // If all points are known, proceed as before
      await sendToApi(jsonData);
    };
    reader.readAsArrayBuffer(file);
  };

  // Helper to send to API
  const sendToApi = async (reports: any[]) => {
    // Get the Firebase ID token from the current user
    const token = user && (await user.getIdToken());
    const res = await fetch('/api/admin-import-reports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        userEmail: user?.email,
        userId: user?.uid,
        reports,
      }),
    });
    const data = await res.json();
    if (data.success) {
      setSuccess(true);
      setSkippedReports(data.skipped || []);
      setShowSkippedPopup((data.skipped || []).length > 0);
      setFile(null);
      setTimeout(() => setSuccess(false), 3000);
    } else {
      alert(data.error || 'Import failed');
    }
  };

  // Popup handler
  const handlePointChoice = async (add: boolean) => {
    if (!currentPoint) return;
    let updatedReports = [...pendingReports];
    if (add) {
      // Get the Firebase ID token from the current user
      const token = user && (await user.getIdToken());
      await fetch('/api/admin-add-point-of-sell', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: currentPoint,
          userEmail: user?.email,
          userId: user?.uid,
        }),
      });
    } else {
      // Remove pointofsell from reports
      updatedReports = updatedReports.map(r =>
        r.pointofsell === currentPoint ? { ...r, pointofsell: '' } : r
      );
    }
    // Move to next unknown point
    const nextIndex = unknownPoints.indexOf(currentPoint) + 1;
    if (nextIndex < unknownPoints.length) {
      setCurrentPoint(unknownPoints[nextIndex]);
      setPendingReports(updatedReports);
    } else {
      // All done, proceed with import
      setUnknownPoints([]);
      setCurrentPoint(null);
      setPendingReports([]);
      await sendToApi(updatedReports);
    }
  };

  if (loading || !roleChecked) return null;

  return (
    <div className="relative h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[#1a0a2e] via-[#0d324d] to-[#1d2671] px-4 overflow-hidden">
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
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

      <div className="z-10 bg-white w-full max-w-md p-6 rounded-2xl shadow-xl">
        <h1 className="text-2xl font-bold text-center mb-4 text-gray-800">Import Reports</h1>

        <input
          type="file"
          accept=".xlsx, .xls"
          onChange={handleFileChange}
          className="w-full mb-4 p-3 rounded-lg border border-gray-300 text-gray-900"
        />

        <button
          onClick={handleImport}
          disabled={!file}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-lg disabled:opacity-50"
        >
          Import Reports from Excel
        </button>

        {success && <p className="text-green-600 mt-4 text-center font-medium">Reports imported successfully!</p>}

        {showSkippedPopup && (
          <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-50">
            <div className="bg-white p-6 rounded-xl shadow-2xl max-w-md w-full">
              <h2 className="text-lg font-bold mb-2 text-red-600">Skipped Reports</h2>
              <p className="text-black mb-2">The following reports were skipped because a report with the same <b>request</b> already exists:</p>
              <ul className="mb-4 max-h-40 overflow-auto text-sm text-gray-800">
                {skippedReports.map((req, idx) => (
                  <li key={idx} className="py-1 border-b last:border-b-0">{req}</li>
                ))}
              </ul>
              <button
                onClick={() => setShowSkippedPopup(false)}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {currentPoint && (
          <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-50">
            <div className="bg-white p-6 rounded-xl shadow-2xl max-w-md w-full">
              <h2 className="text-lg font-bold mb-2 text-blue-600">Unknown Point of Sell</h2>
              <p className="text-black mb-4">
                The point of sell <b>{currentPoint}</b> does not exist in the database.<br />
                Do you want to add it?
              </p>
              <div className="flex gap-4 justify-end">
                <button
                  onClick={() => handlePointChoice(true)}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition"
                >
                  Add Point of Sell
                </button>
                <button
                  onClick={() => handlePointChoice(false)}
                  className="px-4 py-2 bg-gray-400 text-white rounded hover:bg-gray-500 transition"
                >
                  Leave Blank
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        @keyframes float {
          0% { transform: translate(0, 0) rotate(0deg); }
          50% { transform: translate(15px, 25px) rotate(180deg); }
          100% { transform: translate(0, 0) rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
