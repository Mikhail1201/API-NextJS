'use client';
import { useEffect, useState } from 'react';
import UserDropdown from './UserDropdown';

export default function UserDropdownHydrated() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  if (!hydrated) return null;
  return <UserDropdown />;
}