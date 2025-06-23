"use client";

import { useState, useEffect, useRef } from 'react';
import {
  FaUser,
  FaSearch,
  FaPlus,
  FaTrash,
  FaSignOutAlt,
  FaUserEdit,
  FaUserMinus,
} from 'react-icons/fa';
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth } from '@/app/firebase/config';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { getDoc, doc, getFirestore } from 'firebase/firestore';

export default function Homepage() {
  const [user, loading] = useAuthState(auth);
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showBottomButtons, setShowBottomButtons] = useState(false);
  const [roleChecked, setRoleChecked] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const fetchUserData = async () => {
      if (user) {
        try {
          const db = getFirestore();
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          const data = userDoc.exists() ? userDoc.data() : {};
          setUserName(data.name || 'User');
          setUserRole(data.role || '');
          if (data.role === 'admin' || data.role === 'superadmin') {
            setShowBottomButtons(true);
          } else {
            setShowBottomButtons(false);
          }
          if (
            data.role !== 'employee' &&
            data.role !== 'admin' &&
            data.role !== 'superadmin'
          ) {
            await signOut(auth);
            router.push('/login');
          }
          setRoleChecked(true);
        } catch (err) {
          console.error('Error getting user data:', err);
          setUserName('User');
          setUserRole('');
          setShowBottomButtons(false);
          await signOut(auth);
          router.push('/login');
          setRoleChecked(true);
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

  if (loading || !user || !roleChecked) return null;

  const handleAddUpdateUser = () => {
    router.push('/createUser');
  };

  const handleDeleteUser = () => {
    router.push('/deleteUser');
  };

  const handleCreateReport = () => {
    router.push('/createReport');
  };

  const handleGoToReports = () => {
    router.push('/reports');
  };

  const handleDeleteReport = () => {
    router.push('/deleteReport');
  };

  const topButtons = [
    {
      icon: <FaSearch />,
      label: 'Search and Edit',
      baseColor: 'text-[#3498db]',
      hoverColor: 'group-hover:text-[#2980b9]',
      onClick: handleGoToReports,
    },
    {
      icon: <FaPlus />,
      label: 'Create',
      baseColor: 'text-[#2ecc71]',
      hoverColor: 'group-hover:text-[#27ae60]',
      onClick: handleCreateReport,
    },
    {
      icon: <FaTrash />,
      label: 'Delete',
      baseColor: 'text-[#e74c3c]',
      hoverColor: 'group-hover:text-[#e74c3c]',
      onClick: handleDeleteReport, // <-- updated here
    },
  ];

  const bottomButtons = [
    {
      icon: <FaUserEdit />,
      label: 'Add/Update User',
      baseColor: 'text-[#f1c40f]',
      hoverColor: 'group-hover:text-[#f39c12]',
      onClick: handleAddUpdateUser,
    },
    {
      icon: <FaUserMinus />,
      label: 'Delete User',
      baseColor: 'text-[#9b59b6]',
      hoverColor: 'group-hover:text-[#9b59b6]',
      onClick: handleDeleteUser,
    },
  ];

  const allButtons = [...topButtons, ...bottomButtons];

  return (
    <div className="relative min-h-screen flex flex-col items-center bg-gradient-to-br from-[#1a0a2e] via-[#0d324d] to-[#1d2671] p-4 overflow-visible">
      {/* Decorative Background */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute rounded-full bg-white/10 w-[12vw] h-[12vw] top-[10%] left-[10%] animate-[float_20s_linear_infinite]" />
        <div className="absolute rounded-full bg-white/10 w-[10vw] h-[10vw] top-[70%] left-[85%] animate-[float_15s_linear_infinite] delay-[-3s]" />
        <div className="absolute rounded-full bg-white/10 w-[7vw] h-[7vw] top-[25%] left-[80%] animate-[float_12s_linear_infinite] delay-[-5s]" />
      </div>

      {/* Header */}
      <div className="text-center my-6 z-10 animate-fadeInDown">
        <h1 className="text-[2.2rem] text-white font-bold mb-2 drop-shadow-md">
          Main Actions
        </h1>
        <p className="text-white/80 text-sm max-w-[480px] mx-auto">
          Choose what you want to do
        </p>
      </div>

      {/* Button Grid */}
      <div className="w-full max-w-[700px] px-3 flex-1 justify-center z-10 overflow-visible">
        <div className="flex flex-col gap-4 sm:hidden">
          {allButtons.map(({ icon, label, baseColor, hoverColor, onClick }, i) => {
            if (i >= topButtons.length && !showBottomButtons) return null;
            return (
              <div
                key={i}
                onClick={onClick}
                className="relative w-full bg-white h-[140px] rounded-[12px] shadow-md flex flex-col items-center justify-center cursor-pointer group overflow-visible transition-all duration-300 transform hover:-translate-y-1 hover:rotate-1"
              >
                <div className="absolute bottom-2 w-24 h-4 bg-[rgba(0,0,0,0.15)] blur-md rounded-full z-0" />
                <div className={`text-[2rem] mb-1 z-10 transition-colors duration-300 ${baseColor} ${hoverColor} group-hover:animate-pulse`}>
                  {icon}
                </div>
                <span className="text-center text-[0.95rem] font-semibold text-[#333] px-2 z-10">
                  {label}
                </span>
              </div>
            );
          })}
        </div>

        <div className="hidden sm:block">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 w-full mb-4">
            {topButtons.map(({ icon, label, baseColor, hoverColor, onClick }, i) => (
              <div
                key={i}
                onClick={onClick}
                className="relative bg-white h-[150px] rounded-[12px] shadow-md flex flex-col items-center justify-center cursor-pointer group overflow-visible transition-all duration-300 transform hover:-translate-y-2 hover:rotate-1"
              >
                <div className="absolute bottom-2 w-24 h-4 bg-[rgba(0,0,0,0.15)] blur-md rounded-full z-0" />
                <div className={`text-[2.2rem] mb-2 z-10 transition-colors duration-300 ${baseColor} ${hoverColor} group-hover:animate-pulse`}>
                  {icon}
                </div>
                <span className="text-center text-[0.95rem] font-semibold text-[#333] px-2 z-10">
                  {label}
                </span>
              </div>
            ))}
          </div>
          {showBottomButtons && (
            <div className="flex gap-4 w-full">
              {bottomButtons.map(({ icon, label, baseColor, hoverColor, onClick }, i) => (
                <div
                  key={i}
                  onClick={onClick}
                  className="relative flex-1 bg-white h-[150px] rounded-[12px] shadow-md flex flex-col items-center justify-center cursor-pointer group overflow-visible transition-all duration-300 transform hover:-translate-y-2 hover:rotate-1"
                >
                  <div className="absolute bottom-2 w-24 h-4 bg-[rgba(0,0,0,0.15)] blur-md rounded-full z-0" />
                  <div className={`text-[2.2rem] mb-2 z-10 transition-colors duration-300 ${baseColor} ${hoverColor} group-hover:animate-pulse`}>
                    {icon}
                  </div>
                  <span className="text-center text-[0.95rem] font-semibold text-[#333] px-2 z-10">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="text-center text-white/60 text-xs py-3 w-full z-10">
        <p>Main Page © 2025 | All rights reserved</p>
      </footer>

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

        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.15); }
          100% { transform: scale(1); }
        }

        .animate-fadeInDown {
          animation: fadeInDown 0.8s ease forwards;
        }

        .group-hover\\:animate-pulse:hover {
          animation: pulse 0.7s ease;
        }
      `}</style>
    </div>
  );
}
