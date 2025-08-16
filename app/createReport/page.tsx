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
  | 'bill'
  | 'asesorias'            // <- NUEVO (se queda igual, solo se movió de columna)
  | 'servicename'
  | 'servicedescription';

interface PointOfSell {
  id: string;
  name: string;
}

export default function CreateReportPage() {
  const [user, loading] = useAuthState(auth);
  const [formData, setFormData] = useState<Record<FormField, string>>({
    request: '',
    number: '',
    reportdate: new Date().toISOString().split('T')[0],
    description: '',
    pointofsell: '',
    quotation: '',
    deliverycertificate: '',
    state: '',
    bill: '',
    asesorias: '',            // <- en el estado
    servicename: '',
    servicedescription: '',
  });
  const [formMode, setFormMode] = useState<'report' | 'pointofsell'>('report');
  const [pointsOfSell, setPointsOfSell] = useState<PointOfSell[]>([]);
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
    setFormData(prev => ({ ...prev, [name]: value }));
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
        asesorias: '',
        servicename: '',
        servicedescription: '',
      });
    }
  };

  if (loading || !user) return null;

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center p-4">
      {/* Form Container con ancho dinámico */}
      <div
        className={`z-10 w-full ${
          formMode === 'pointofsell' ? 'max-w-md' : 'max-w-3xl'
        } bg-white p-6 rounded-2xl shadow-xl transition-[max-width] duration-300`}
      >
        <div className="flex justify-center gap-4 mb-4">
          <button
            type="button"
            onClick={() => setFormMode('report')}
            className={`cursor-pointer px-4 py-2 rounded-lg text-sm font-semibold transition ${
              formMode === 'report'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Crear Reporte
          </button>
          <button
            type="button"
            onClick={() => setFormMode('pointofsell')}
            className={`cursor-pointer px-4 py-2 rounded-lg text-sm font-semibold transition ${
              formMode === 'pointofsell'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Agregar Punto de Venta
          </button>
        </div>

        {formMode === 'report' && (
          <>
            <div className="text-center mb-4">
              <h1 className="text-2xl font-bold text-gray-800">Crear Reporte</h1>
            </div>

            <form
              className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-2 text-sm"
              onSubmit={handleSubmit}
            >
              {/* Columna 1 (4 filas) */}
              <div className="flex flex-col gap-2">
                <div className="flex flex-col">
                  <label className="text-gray-700 mb-1 text-sm font-medium">Solicitud/Aviso</label>
                  <input
                    type="text"
                    name="request"
                    className="p-2 rounded-md border border-gray-300 text-sm text-black"
                    value={formData.request}
                    onChange={handleChange}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-gray-700 mb-1 text-sm font-medium">Presupuesto</label>
                  <input
                    type="text"
                    name="number"
                    className="p-2 rounded-md border border-gray-300 text-sm text-black"
                    value={formData.number}
                    onChange={handleChange}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-gray-700 mb-1 text-sm font-medium">Fecha de Reporte</label>
                  <input
                    type="date"
                    name="reportdate"
                    className="p-2 rounded-md border border-gray-300 text-sm text-black"
                    value={formData.reportdate}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-gray-700 mb-1 text-sm font-medium">Descripción</label>
                  <textarea
                    name="description"
                    className="p-2 rounded-md border border-gray-300 text-sm text-black resize-none"
                    value={formData.description}
                    onChange={handleChange}
                    rows={1}
                  />
                </div>
              </div>

              {/* Columna 2 (4 filas) */}
              <div className="flex flex-col gap-2">
                <div className="flex flex-col">
                  <label className="text-gray-700 mb-1 text-sm font-medium">Punto de Venta</label>
                  <select
                    name="pointofsell"
                    className="p-2 rounded-md border border-gray-300 text-sm text-black"
                    required
                    value={formData.pointofsell}
                    onChange={handleChange}
                  >
                    <option value="" disabled>
                      Selecciona un punto de venta
                    </option>
                    {pointsOfSell.map((pos) => (
                      <option key={pos.id} value={pos.name}>
                        {pos.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col">
                  <label className="text-gray-700 mb-1 text-sm font-medium">Cotización</label>
                  <input
                    type="text"
                    name="quotation"
                    className="p-2 rounded-md border border-gray-300 text-sm text-black"
                    value={formData.quotation}
                    onChange={handleChange}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-gray-700 mb-1 text-sm font-medium">Acta de Entrega</label>
                  <input
                    type="text"
                    name="deliverycertificate"
                    className="p-2 rounded-md border border-gray-300 text-sm text-black"
                    value={formData.deliverycertificate}
                    onChange={handleChange}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-gray-700 mb-1 text-sm font-medium">Factura</label>
                  <input
                    type="text"
                    name="bill"
                    className="p-2 rounded-md border border-gray-300 text-sm text-black"
                    value={formData.bill}
                    onChange={handleChange}
                  />
                </div>
              </div>

              {/* Columna 3 (4 filas) — movimos ASESORÍAS aquí */}
              <div className="flex flex-col gap-2">
                <div className="flex flex-col">
                  <label className="text-gray-700 mb-1 text-sm font-medium">Estado</label>
                  <select
                    name="state"
                    className="p-2 rounded-md border border-gray-300 text-sm text-black"
                    required
                    value={formData.state}
                    onChange={handleChange}
                  >
                    <option value="" disabled>
                      Selecciona un estado
                    </option>
                    <option value="En Programación">En Programación</option>
                    <option value="En Espera Aprobación">En Espera Aprobación</option>
                    <option value="pndte cotización">Pendiente de Cotización</option>
                    <option value="En Ejecución">En Ejecución</option>
                    <option value="Ejecutado">Ejecutado</option>
                    <option value="N/A">N/A</option>
                  </select>
                </div>
                <div className="flex flex-col">
                  <label className="text-gray-700 mb-1 text-sm font-medium">Nombre del Servicio</label>
                  <input
                    type="text"
                    name="servicename"
                    className="p-2 rounded-md border border-gray-300 text-sm text-black"
                    value={formData.servicename}
                    onChange={handleChange}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-gray-700 mb-1 text-sm font-medium">Descripción del Servicio</label>
                  <textarea
                    name="servicedescription"
                    className="p-2 rounded-md border border-gray-300 text-sm text-black resize-none"
                    value={formData.servicedescription}
                    onChange={handleChange}
                    rows={1}
                  />
                </div>
                {/* ASESORÍAS aquí para completar 4 filas */}
                <div className="flex flex-col">
                  <label className="text-gray-700 mb-1 text-sm font-medium">Asesorías</label>
                  <textarea
                    name="asesorias"
                    className="p-2 rounded-md border border-gray-300 text-sm text-black resize-none"
                    value={formData.asesorias}
                    onChange={handleChange}
                    rows={1}
                    placeholder="Detalle, link o nota de asesorías"
                  />
                </div>
              </div>

              <div className="md:col-span-3 flex justify-end mt-2">
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

        {formMode === 'pointofsell' && <AddPointOfSellForm />}
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
  const [error, setError] = useState('');

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
      // Normaliza a MAYÚSCULAS al enviar (sin mover el cursor mientras escribe)
      const normalized = name.trim().toUpperCase();

      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch('/api/admin-add-point-of-sell', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ name: normalized }),
      });
      const result = await response.json();
      if (!result.success) {
        setError(result.error || 'No se pudo agregar el punto de venta');
        return;
      }
      showSuccessDiv('¡Punto de venta agregado exitosamente!');
      setName('');
    } catch {
      setError('No se pudo agregar el punto de venta');
    }
  };

  return (
    <form onSubmit={handleAdd} className="mx-auto w-full max-w-sm flex flex-col gap-3">
      <h2 className="text-center text-xl font-semibold text-gray-800">
        Agregar Punto de Venta
      </h2>

      <label className="text-gray-700 text-sm font-medium mb-1">
        Nombre del Punto de Venta
      </label>
      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}  // sin toUpperCase en cada tecla
        className="p-2 rounded-md border border-gray-300 text-sm text-black w-full uppercase"
        placeholder="INGRESE EL NOMBRE DEL PUNTO"
        required
        autoComplete="off"
      />

      <button
        type="submit"
        className="w-full sm:w-auto self-center cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition duration-200"
      >
        Agregar Punto de Venta
      </button>

      {error && <span className="text-red-600 text-sm text-center">{error}</span>}
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
