'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/app/firebase/config';
import { useAuthState } from 'react-firebase-hooks/auth';
import { getDoc, doc, getFirestore, collection, getDocs } from 'firebase/firestore';
import { signOut } from 'firebase/auth';

type FormField =
  | 'request'
  | 'number'
  | 'reportdate'
  | 'description'
  | 'pointofsell'
  | 'quotation'
  | 'deliverycertificate'
  | 'state'
  | 'bill';

export default function CreateReportPage() {
  const [user, loading] = useAuthState(auth);
  const [userRole, setUserRole] = useState('');
  const [formData, setFormData] = useState<{
    [K in FormField]: string;
  }>({
    request: '',
    number: '',
    reportdate: new Date().toISOString().split('T')[0],
    description: '',
    pointofsell: '',
    quotation: '',
    deliverycertificate: '',
    state: '',
    bill: '',
  });
  const [formMode, setFormMode] = useState<'report' | 'pointofsell'>('report');
  const [pointsOfSell, setPointsOfSell] = useState<{ id: string; name: string }[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const fetchUserData = async () => {
      if (user) {
        const db = getFirestore();
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const data = userDoc.exists() ? userDoc.data() : {};
        setUserRole(data.role || '');
        if (!data.role) {
          await signOut(auth);
          router.push('/login');
        }
      }
    };
    fetchUserData();
  }, [user, router]);

  useEffect(() => {
    const fetchPointsOfSell = async () => {
      const db = getFirestore();
      const snapshot = await getDocs(collection(db, 'point of sell'));
      setPointsOfSell(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name })));
    };
    fetchPointsOfSell();
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!auth.currentUser) {
      router.push('/login');
      return;
    }
    const idToken = await auth.currentUser.getIdToken();
    const response = await fetch('/api/admin-create-report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(formData),
    });
    const result = await response.json();
    if (result.success) {
      showSuccessDiv('¡Reporte creado exitosamente!');
      // Optionally reset form
      setFormData({
        request: '',
        number: '',
        reportdate: new Date().toISOString().split('T')[0],
        description: '',
        pointofsell: '',
        quotation: '',
        deliverycertificate: '',
        state: '',
        bill: '',
      });
      setAttachedFiles([]);
    }
  };

  if (loading || !user) return null;

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[#1a0a2e] via-[#0d324d] to-[#1d2671] p-4">
      {/* Background animations */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute rounded-full bg-white/10 w-[12vw] h-[12vw] top-[10%] left-[10%] animate-[float_20s_linear_infinite]" />
        <div className="absolute rounded-full bg-white/10 w-[10vw] h-[10vw] top-[70%] left-[85%] animate-[float_15s_linear_infinite] delay-[-3s]" />
        <div className="absolute rounded-full bg-white/10 w-[7vw] h-[7vw] top-[25%] left-[80%] animate-[float_12s_linear_infinite] delay-[-5s]" />
      </div>

      {/* Form Container */}
      <div className="z-10 w-full max-w-3xl bg-white p-6 rounded-2xl shadow-xl">
        <div className="flex justify-center gap-4 mb-4">
          <button
            type="button"
            onClick={() => setFormMode('report')}
            className={`cursor-pointer px-4 py-2 rounded-lg text-sm font-semibold transition ${formMode === 'report' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
          >
            Crear Reporte
          </button>
          <button
            type="button"
            onClick={() => setFormMode('pointofsell')}
            className={`cursor-pointer px-4 py-2 rounded-lg text-sm font-semibold transition ${formMode === 'pointofsell' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
          >
            Agregar Punto de Venta
          </button>
        </div>

        {formMode === 'report' && (
          <>
            <div className="text-center mb-4">
              <h1 className="text-2xl font-bold text-gray-800">Crear Reporte</h1>
            </div>

            <form className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm" onSubmit={handleSubmit}>
              {Object.entries({
                "Solicitud": "request",
                "Número": "number",
                "Fecha de Reporte": "reportdate",
                "Descripción": "description",
                "Punto de Venta": "pointofsell",
                "Cotización": "quotation",
                "Certificado de Entrega": "deliverycertificate",
                "Estado": "state",
                "Factura": "bill"
              } as Record<string, FormField>).map(([label, field]) => (
                <div key={label} className="flex flex-col">
                  <label className="text-gray-700 mb-1 text-sm font-medium">{label}</label>
                  {(field as FormField) === "state" ? (
                    <select
                      name="state"
                      className="p-2 rounded-md border border-gray-300 text-sm text-black"
                      required
                      value={formData.state}
                      onChange={handleChange}
                    >
                      <option value="En Programación">En Programación</option>
                      <option value="En Espera Aprobación">En Espera Aprobación</option>
                      <option value="pndte cotización">Pendiente de Cotización</option>
                      <option value="En Ejecución">En Ejecución</option>
                      <option value="Ejecutado">Ejecutado</option>
                      <option value="N/A">N/A</option>
                    </select>
                  ) : (field as FormField) === "pointofsell" ? (
                    <select
                      name="pointofsell"
                      className="p-2 rounded-md border border-gray-300 text-sm text-black"
                      value={formData.pointofsell}
                      onChange={handleChange}
                      required
                    >
                      <option value="">Seleccione un punto de venta</option>
                      {pointsOfSell.map((pos) => (
                        <option key={pos.id} value={pos.name}>
                          {pos.name}
                        </option>
                      ))}
                    </select>
                  ) : field === "description" ? (
                    <div className="flex flex-col relative">
                      <textarea
                        name="description"
                        className="p-2 pr-10 rounded-md border border-gray-300 text-sm text-black resize-none"
                        value={formData.description}
                        onChange={handleChange}
                        placeholder="Ingrese la descripción"
                        rows={1}
                      />
                      <input
                        id="file-upload"
                        type="file"
                        multiple
                        className="hidden"
                        onChange={e => {
                          if (e.target.files) {
                            setAttachedFiles(Array.from(e.target.files));
                          }
                        }}
                      />
                      <label
                        htmlFor="file-upload"
                        className="absolute right-2 top-2 cursor-pointer flex items-center"
                        style={{ lineHeight: 0 }}
                        title="Adjuntar archivo"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500 hover:text-blue-700 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l7.071-7.071a4 4 0 00-5.657-5.657l-7.071 7.071a6 6 0 108.485 8.485l6.364-6.364" />
                        </svg>
                      </label>
                      {attachedFiles.length > 0 && (
                        <span className="text-xs text-gray-700 mt-1">
                          {attachedFiles.map(file => file.name).join(', ')}
                        </span>
                      )}
                    </div>
                  ) : (
                    <input
                      type={field === 'reportdate' ? 'date' : 'text'}
                      name={field}
                      className="p-2 rounded-md border border-gray-300 text-sm text-black"
                      value={formData[field] || ''}
                      onChange={handleChange}
                      required={
                        field === 'reportdate' ||
                        field === 'state'
                      }
                    />
                  )}
                </div>
              ))}

              <div className="col-span-2 flex justify-end mt-2">
                <button
                  type="submit"
                  className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition duration-200"
                >
                  Crear Reporte
                </button>
              </div>
            </form>
          </>
        )}

        {formMode === 'pointofsell' && (
          <AddPointOfSellForm />
        )}
      </div>

      <button
        onClick={() => router.push('/')}
        className="absolute top-4 left-4 z-20 bg-white/90 hover:bg-white text-blue-600 p-3 rounded-full shadow-md transition cursor-pointer"
        aria-label="Volver al inicio"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <style jsx global>{`
        @keyframes float {
          0% { transform: translate(0, 0) rotate(0deg); }
          50% { transform: translate(15px, 25px) rotate(180deg); }
          100% { transform: translate(0, 0) rotate(360deg); }
        }

        @keyframes fadeIn {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }

        @keyframes fadeOut {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }

        .fade-in-success {
          animation: fadeIn 0.5s forwards, fadeOut 0.5s forwards 2.5s;
        }
      `}</style>
    </div>
  );
}

function AddPointOfSellForm() {
  const [name, setName] = useState('');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const db = getFirestore();

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (!name.trim()) {
        setError('El nombre es obligatorio');
        return;
      }
      if (!auth.currentUser) {
        setError('No autenticado');
        return;
      }
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch('/api/admin-add-point-of-sell', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ name }),
      });
      const result = await response.json();
      if (!result.success) {
        setError(result.error || 'No se pudo agregar el punto de venta');
        return;
      }
      showSuccessDiv('¡Punto de venta agregado exitosamente!');
      setName('');
    } catch (err) {
      setError('No se pudo agregar el punto de venta');
    }
  };

  return (
    <form onSubmit={handleAdd} className="flex flex-col items-center gap-3">
      <label className="text-gray-700 text-sm font-medium mb-1">Nombre del Punto de Venta</label>
      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value.toUpperCase())}
        className="p-2 rounded-md border border-gray-300 text-sm text-black w-64 uppercase"
        placeholder="Ingrese el nombre del punto de venta"
        required
      />
      <button
        type="submit"
        className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition duration-200"
      >
        Agregar Punto de Venta
      </button>
      {error && <span className="text-red-600 text-sm">{error}</span>}
    </form>
  );
}

function showSuccessDiv(message: string) {
  const successDiv = document.createElement('div');
  successDiv.className =
    'fixed bottom-4 right-4 bg-green-500 text-white p-4 rounded-lg shadow-lg flex items-center gap-2 opacity-0 transition-opacity duration-500 z-50 fade-in-success';
  successDiv.innerHTML = `
    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.586-6.586a2 2 0 00-2.828 0l-10 10a2 2 0 000 2.828l3.172 3.172a2 2 0 002.828 0l10-10a2 2 0 000-2.828z"></path>
    </svg>
    <span>${message}</span>
  `;
  document.body.appendChild(successDiv);
  setTimeout(() => successDiv.classList.add('opacity-100'), 10);
  setTimeout(() => {
    successDiv.classList.remove('opacity-100');
    setTimeout(() => successDiv.remove(), 500);
  }, 3000);
}
