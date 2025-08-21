"use client";

import { useState, useEffect, type ReactNode } from "react";
import {
  FaSearch,
  FaPlus,
  FaTrash,
  FaUserEdit,
  FaUserMinus,
} from "react-icons/fa";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "@/app/firebase/config";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { getDoc, doc, getFirestore } from "firebase/firestore";

// Tipos
type ButtonDef = {
  icon: ReactNode;
  label: string;
  bg: string;
  bgHover: string;
  iconColor: string;
  labelColor: string;
  onClick: () => void;
};

type CardProps = ButtonDef & {
  tall?: boolean;
};

export default function Homepage() {
  const [user, loading] = useAuthState(auth);
  const [showBottomButtons, setShowBottomButtons] = useState(false);
  const [roleChecked, setRoleChecked] = useState(false);

  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    const fetchUserData = async () => {
      if (user) {
        try {
          const db = getFirestore();
          const userDoc = await getDoc(doc(db, "users", user.uid));
          const data = userDoc.exists() ? userDoc.data() : {};
          if (data.role === "admin" || data.role === "superadmin") {
            setShowBottomButtons(true);
          } else {
            setShowBottomButtons(false);
          }
          if (
            data.role !== "employee" &&
            data.role !== "admin" &&
            data.role !== "superadmin"
          ) {
            await signOut(auth);
            router.push("/login");
          }
          setRoleChecked(true);
        } catch {
          setShowBottomButtons(false);
          await signOut(auth);
          router.push("/login");
          setRoleChecked(true);
        }
      }
    };
    fetchUserData();
  }, [user, router]);

  if (loading || !user || !roleChecked) return null;

  const handleAddUpdateUser = () => router.push("/createUser");
  const handleDeleteUser = () => router.push("/deleteUser");
  const handleCreateReport = () => router.push("/createReport");
  const handleGoToReports = () => router.push("/reports");
  const handleDeleteReport = () => router.push("/deleteReport");

  // Definiciones con colores INVERTIDOS (bg = color del botón, icon/label = blanco u oscuro según contraste)
  const topButtons: ButtonDef[] = [
    {
      icon: <FaSearch />,
      label: "Buscar y Editar",
      bg: "bg-[#3498db]",
      bgHover: "hover:bg-[#2980b9]",
      iconColor: "text-[#1f2937]",
      labelColor: "text-[#1f2937]",
      onClick: handleGoToReports,
    },
    {
      icon: <FaPlus />,
      label: "Crear",
      bg: "bg-[#2ecc71]",
      bgHover: "hover:bg-[#27ae60]",
      iconColor: "text-[#1f2937]",
      labelColor: "text-[#1f2937]",
      onClick: handleCreateReport,
    },
    {
      icon: <FaTrash />,
      label: "Eliminar",
      bg: "bg-[#e74c3c]",
      bgHover: "hover:bg-[#c0392b]",
      iconColor: "text-[#1f2937]",
      labelColor: "text-[#1f2937]",
      onClick: handleDeleteReport,
    },
  ];

  const bottomButtons: ButtonDef[] = [
    {
      icon: <FaUserEdit />,
      label: "Añadir/Actualizar Usuario",
      bg: "bg-[#f1c40f]",
      bgHover: "hover:bg-[#f39c12]",
      // Amarillo con texto oscuro para accesibilidad
      iconColor: "text-[#1f2937]", // gray-800
      labelColor: "text-[#1f2937]",
      onClick: handleAddUpdateUser,
    },
    {
      icon: <FaUserMinus />,
      label: "Eliminar Usuario",
      bg: "bg-[#9b59b6]",
      bgHover: "hover:bg-[#8e44ad]",
      iconColor: "text-[#1f2937]",
      labelColor: "text-[#1f2937]",
      onClick: handleDeleteUser,
    },
  ];

  const allButtons: ButtonDef[] = [...topButtons, ...bottomButtons];

  const Card = ({
    icon,
    label,
    bg,
    bgHover,
    iconColor,
    labelColor,
    onClick,
    tall = false,
  }: CardProps) => (
    <div
      onClick={onClick}
      className={`relative ${bg} ${bgHover} ${
        tall ? "h-[150px]" : "h-[140px]"
      } w-full rounded-[12px] shadow-md ring-1 ring-white/10 flex flex-col items-center justify-center cursor-pointer group overflow-visible transition-all duration-300 transform hover:-translate-y-2 hover:rotate-1`}
    >
      {/* Sombra inferior */}
      <div className="absolute bottom-2 w-24 h-4 bg-black/25 blur-md rounded-full z-0" />
      {/* Icono */}
      <div
        className={`text-[2.2rem] mb-2 z-10 transition-transform duration-300 ${iconColor} group-hover:animate-pulse`}
      >
        {icon}
      </div>
      {/* Label */}
      <span
        className={`text-center text-[0.95rem] font-semibold px-2 z-10 ${labelColor}`}
      >
        {label}
      </span>
    </div>
  );

  return (
    <div className="relative flex flex-col items-center p-4 overflow-visible">
      {/* Header */}
      <div className="text-center my-6 z-10 animate-fadeInDown">
        <h1 className="text-[2.2rem] text-white font-bold mb-2 drop-shadow-md">
          Acciones Principales
        </h1>
        <p className="text-white/80 text-sm max-w-[480px] mx-auto">
          Elige lo que deseas hacer
        </p>
      </div>

      {/* Button Grid */}
      <div className="w-full max-w-[700px] px-3 flex-1 justify-center z-10 overflow-visible">
        {/* Mobile (columna) */}
        <div className="flex flex-col gap-4 sm:hidden">
          {allButtons.map(
            (
              { icon, label, bg, bgHover, iconColor, labelColor, onClick },
              i
            ) => {
              if (i >= topButtons.length && !showBottomButtons) return null;
              return (
                <Card
                  key={i}
                  icon={icon}
                  label={label}
                  bg={bg}
                  bgHover={bgHover}
                  iconColor={iconColor}
                  labelColor={labelColor}
                  onClick={onClick}
                  tall={false}
                />
              );
            }
          )}
        </div>

        {/* Desktop */}
        <div className="hidden sm:block">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 w-full mb-4">
            {topButtons.map((btn, i) => (
              <Card key={i} {...btn} tall />
            ))}
          </div>
          {showBottomButtons && (
            <div className="flex gap-4 w-full">
              {bottomButtons.map((btn, i) => (
                <div key={i} className="flex-1">
                  <Card {...btn} tall />
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
        @keyframes fadeInDown {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes pulse {
          0% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.15);
          }
          100% {
            transform: scale(1);
          }
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
