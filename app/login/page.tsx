'use client';
import { useState } from 'react';
import { FaLock, FaUser, FaEye, FaEyeSlash } from 'react-icons/fa';
import { useSignInWithEmailAndPassword } from 'react-firebase-hooks/auth';
import { auth } from '@/app/firebase/config';
import { useRouter } from 'next/navigation';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [remember, setRemember] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showError, setShowError] = useState(false);

    const [signInWithEmailAndPassword, user, loading, error] = useSignInWithEmailAndPassword(auth);
    const router = useRouter();


    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        try {
            const userCredential = await signInWithEmailAndPassword(email, password);
            if (userCredential && userCredential.user) {
                // Login successful
                setEmail('');
                setPassword('');
                router.push('/');
            } else {
                // Login failed (invalid credentials)
                setShowError(true);
            }
        } catch (error) {
            console.error('Login failed:', error);
            setShowError(true);
        }
    };

    return (
        <div className="relative min-h-screen flex justify-center items-center bg-gradient-to-br from-[#1a0a2e] via-[#0d324d] to-[#1d2671] p-6 overflow-hidden">
            {/* Background shapes */}
            <div className="absolute inset-0 z-0 overflow-hidden">
                <div className="absolute top-[15%] left-[10%] w-[15vw] h-[15vw] rounded-full bg-white/5 animate-[float_20s_linear_infinite]"></div>
                <div className="absolute top-[65%] left-[85%] w-[12vw] h-[12vw] rounded-full bg-white/5 animate-[float_15s_linear_infinite_-3s]"></div>
                <div className="absolute top-[25%] left-[80%] w-[8vw] h-[8vw] rounded-full bg-white/5 animate-[float_12s_linear_infinite_-5s]"></div>
            </div>

            {/* Login Box */}
            <div className="z-10 w-full max-w-sm bg-white rounded-2xl shadow-xl p-8">
                <div className="text-center mb-6">
                    <img
                        src="Logo.jpeg"
                        alt="CAM Soluciones S.A.S. Logo"
                        className="mx-auto mb-2 w-32 h-32 object-contain"
                        draggable={false}
                    />
                    <h1 className="text-xl font-bold text-gray-800">Bienvenido</h1>
                    <p className="text-sm text-gray-500">Inicie sesión para acceder a su cuenta</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Email */}
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

                    {/* Password */}
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

                    {/* Remember Me */}
                    <label className="flex items-center text-sm text-gray-600">
                        <input
                            type="checkbox"
                            checked={remember}
                            onChange={(e) => setRemember(e.target.checked)}
                            className="mr-2 accent-blue-500"
                        />
                        Recuérdame
                    </label>

                    {/* Submit */}
                    <button
                        type="submit"
                        className="cursor-pointer w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-md transition-all"
                    >
                        Acceder
                    </button>

                    {/* Error Message */}
                    {showError && (
                        <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-50">
                            <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-xs text-center">
                                <h2 className="text-lg font-bold mb-2 text-red-600">Login Failed</h2>
                                <p className="mb-4 text-gray-800">Invalid email or password.</p>
                                <button
                                    onClick={() => setShowError(false)}
                                    className="cursor-pointer px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Footer */}
                    <div className="pt-4 border-t text-center text-xs text-gray-500">
                        Mik's Login &copy; 2025
                    </div>
                </form>
            </div>

            {/* Keyframes for float animation */}
            <style jsx>{`
        @keyframes float {
          0% {
            transform: translate(0, 0) rotate(0deg);
          }
          50% {
            transform: translate(20px, 30px) rotate(180deg);
          }
          100% {
            transform: translate(0, 0) rotate(360deg);
          }
        }
      `}</style>
        </div>
    );
}
