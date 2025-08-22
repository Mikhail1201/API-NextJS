'use client';
import { useState } from 'react';
import { FaLock, FaUser, FaEye, FaEyeSlash } from 'react-icons/fa';
import { useSignInWithEmailAndPassword } from 'react-firebase-hooks/auth';
import { auth } from '@/app/firebase/config';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

// 👇 NUEVO: imports para controlar la persistencia
import {
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
} from 'firebase/auth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showError, setShowError] = useState(false);

  const [signInWithEmailAndPassword] = useSignInWithEmailAndPassword(auth);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      // 1) Configura la persistencia según el checkbox
      try {
        await setPersistence(
          auth,
          remember ? browserLocalPersistence : browserSessionPersistence
        );
      } catch {
        // Fallback si el navegador bloquea storage (modo incógnito, etc.)
        await setPersistence(auth, inMemoryPersistence);
      }

      // 2) Inicia sesión
      const userCredential = await signInWithEmailAndPassword(email, password);
      if (userCredential && userCredential.user) {
        setEmail('');
        setPassword('');
        router.push('/');
      } else {
        setShowError(true);
      }
    } catch {
      setShowError(true);
    }
  };

  return (
    <div className="relative min-h-screen flex justify-center items-center p-6 overflow-hidden">
      {/* Login Box */}
      <div className="z-10 w-full max-w-sm bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-6">
          <Image
            src="/Logo.jpeg"
            alt="CAM Soluciones S.A.S. Logo"
            width={128}
            height={128}
            className="mx-auto mb-2 object-contain"
            draggable={false}
          />
          <h1 className="text-xl font-bold text-gray-800">Bienvenido</h1>
          <p className="text-sm text-gray-500">Inicie sesión para acceder a su cuenta</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <FaUser className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
            <input
              type="email"
              placeholder="E-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full pl-10 pr-4 py-3 bg-gray-100 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800"
            />
          </div>
          <div className="relative">
            <FaLock className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full pl-10 pr-10 py-3 bg-gray-100 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="cursor-pointer absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-500"
            >
              {showPassword ? <FaEyeSlash /> : <FaEye />}
            </button>
          </div>
          <label className="flex items-center text-sm text-gray-600">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mr-2 accent-blue-500"
            />
            Recuérdame
          </label>
          <button
            type="submit"
            className="cursor-pointer w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-md transition-all"
          >
            Acceder
          </button>
          {showError && (
            <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-50">
              <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-xs text-center">
                <h2 className="text-lg font-bold mb-2 text-red-600">Error de inicio de sesión</h2>
                <p className="mb-4 text-gray-800">Correo o contraseña inválidos.</p>
                <button
                  onClick={() => setShowError(false)}
                  className="cursor-pointer px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                >
                  Cerrar
                </button>
              </div>
            </div>
          )}
          <div className="pt-4 border-t text-center text-xs text-gray-500">
            Mik&apos;s Login &copy; 2025
          </div>
        </form>
      </div>
    </div>
  );
}
