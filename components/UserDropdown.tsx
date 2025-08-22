'use client';

import { useState, useRef, useEffect } from 'react';
import { FaUser, FaSignOutAlt } from 'react-icons/fa';
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth } from '@/app/firebase/config';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { getDoc, doc, getFirestore } from 'firebase/firestore';

type UserDoc = { name?: string; role?: string };

export default function UserDropdown() {
  const [user, loading] = useAuthState(auth);
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchUserData = async () => {
      if (user) {
        try {
          const db = getFirestore();
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          const data: UserDoc = userDoc.exists() ? userDoc.data() as UserDoc : {};
          setUserName(data.name || 'User');
          setUserRole(data.role || '');
        } catch {
          setUserName('User');
          setUserRole('');
        }
      }
    };
    fetchUserData();
  }, [user]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (loading || !user) return null;

  return (
    <div ref={dropdownRef} className="fixed top-4 right-4 z-[99999]">
      <div
        onClick={() => setDropdownOpen((prev) => !prev)}
        className="flex items-center bg-white/90 rounded-full px-3 py-2 shadow-md cursor-pointer transition-all hover:bg-white"
      >
        <div className="w-[30px] h-[30px] bg-gradient-to-br from-[#3498db] to-[#2980b9] rounded-full flex items-center justify-center text-white text-sm">
          <FaUser />
        </div>
        <span className="font-semibold text-[#1a0a2e] mx-2 text-sm hidden sm:inline">
          {userName || '...'}
        </span>
        <div className="sm:hidden flex flex-col justify-between w-6 h-5">
          <span className="block h-[2px] bg-[#1a0a2e] rounded" />
          <span className="block h-[2px] bg-[#1a0a2e] rounded" />
          <span className="block h-[2px] bg-[#1a0a2e] rounded" />
        </div>
      </div>

      {dropdownOpen && (
        <div className="absolute top-[50px] right-0 bg-white rounded-lg shadow-2xl w-40 z-[99999] opacity-100 transition-all">
          {/* Importar - solo superadmin */}
          {userRole === 'superadmin' && (
            <div
              onClick={() => {
                setDropdownOpen(false);
                router.push('/import');
              }}
              className="flex items-center px-4 py-3 text-sm text-gray-800 hover:bg-green-50 hover:text-green-600 cursor-pointer border-b border-gray-100"
            >
              <span className="mr-2">⬆️</span> Importar
            </div>
          )}

          {/* Exportar - cualquier usuario con role */}
          {userRole && (
            <div
              onClick={() => {
                setDropdownOpen(false);
                router.push('/export');
              }}
              className="flex items-center px-4 py-3 text-sm text-gray-800 hover:bg-purple-50 hover:text-purple-600 cursor-pointer border-b border-gray-100"
            >
              <span className="mr-2">⬇️</span> Exportar
            </div>
          )}

          {/* Logs - solo superadmin */}
          {userRole === 'superadmin' && (
            <div
              onClick={() => {
                setDropdownOpen(false);
                router.push('/logs');
              }}
              className="flex items-center px-4 py-3 text-sm text-gray-800 hover:bg-yellow-50 hover:text-yellow-600 cursor-pointer border-b border-gray-100"
            >
              <span className="mr-2">📝</span> Registros
            </div>
          )}

          {/* Salir */}
          <div
            onClick={async () => {
              setDropdownOpen(false);
              await signOut(auth);
              router.push('/login');
            }}
            className="flex items-center px-4 py-3 text-sm text-gray-800 hover:bg-blue-50 hover:text-blue-600 cursor-pointer"
          >
            <FaSignOutAlt className="mr-2 w-4" /> Salir
          </div>
        </div>
      )}
    </div>
  );
}
