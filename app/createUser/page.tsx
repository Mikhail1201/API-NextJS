'use client';

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FaUserPlus, FaEye, FaEyeSlash } from 'react-icons/fa';
import { useAuthState, useCreateUserWithEmailAndPassword } from 'react-firebase-hooks/auth';
import { auth } from '@/app/firebase/config';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { updatePassword, updateProfile, signInWithEmailAndPassword } from 'firebase/auth';

export default function CreateUserPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: '',
  });
  const [formMode, setFormMode] = useState<'create' | 'update'>('create');
  const [showPassword, setShowPassword] = useState(false);
  const [createUserWithEmailAndPassword] = useCreateUserWithEmailAndPassword(auth);
  const router = useRouter();
  const [user, loading] = useAuthState(auth);

  // New state for update mode
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [updateField, setUpdateField] = useState<'name' | 'password' | 'role'>('name');
  const [updateValue, setUpdateValue] = useState('');
  const [userRole, setUserRole] = useState<string | null>(null);

  // Fetch all users for update selector
  useEffect(() => {
    if (formMode === 'update') {
      const fetchUsers = async () => {
        const db = getFirestore();
        const usersSnap = await getDocs(collection(db, 'users'));
        setAllUsers(usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      };
      fetchUsers();
    }
  }, [formMode]);

  useEffect(() => {
    const fetchRole = async () => {
      if (user) {
        const db = getFirestore();
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          setUserRole(userDocSnap.data().role || null);
        }
      }
    };
    fetchRole();
  }, [user]);

  useEffect(() => {
    if (!loading && userRole && userRole !== 'admin' && userRole !== 'superadmin') {
      notFound();
    }
  }, [loading, userRole]);

  const fetchUserData = async () => {
    if (user) {
      const db = getFirestore();
      const userDocRef = doc(db, 'users', user.uid);
      const userDocSnap = await getDoc(userDocRef);
      if (userDocSnap.exists()) {
        return userDocSnap.data();
      }
    }
    return null;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const logAction = async (action: string, details: string) => {
    const db = getFirestore();
    await addDoc(collection(db, 'logs'), {
      action,
      details,
      timestamp: serverTimestamp(),
      performedBy: user?.email || user?.uid || 'unknown',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formMode === 'create') {
      try {
        const userData = await fetchUserData();
        if (!userData || (userData.role !== 'admin' && userData.role !== 'superadmin')) {
          alert('Only admins can create new users.');
          return;
        }

        if (!auth.currentUser) {
          alert('No authenticated user found.');
          return;
        }
        const idToken = await auth.currentUser.getIdToken();

        const response = await fetch('/api/admin-create-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            name: formData.name,
            email: formData.email,
            password: formData.password,
            role: formData.role,
          }),
        });

        const result = await response.json();
        if (!result.success) {
          alert('Failed to create user: ' + result.error);
          return;
        }

        // Log the action
        await logAction(
          'create',
          `Created user '${formData.name}' with role '${formData.role}'`
        );

        // Show success div with fade-in and auto-disappear
        const successDiv = document.createElement('div');
        successDiv.className =
          'fixed bottom-4 right-4 bg-green-500 text-white p-4 rounded-lg shadow-lg flex items-center gap-2 opacity-0 transition-opacity duration-500 z-50 fade-in-success';
        successDiv.innerHTML = `
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.586-6.586a2 2 0 00-2.828 0l-10 10a2 2 0 000 2.828l3.172 3.172a2 2 0 002.828 0l10-10a2 2 0 000-2.828z"></path>
          </svg>
          <span>User created successfully!</span>
        `;
        document.body.appendChild(successDiv);
        setTimeout(() => successDiv.classList.add('opacity-100'), 10);
        setTimeout(() => {
          successDiv.classList.remove('opacity-100');
          setTimeout(() => successDiv.remove(), 500);
        }, 3000);

        setFormData({ name: '', email: '', password: '', role: '' });

      } catch (err) {
        alert('Failed to create user. Please try again.');
        console.error('Error creating user:', err);
      }
    } else {
      // UPDATE MODE
      if (!selectedUserId) {
        alert('Please select a user to update.');
        return;
      }
      if (!updateValue) {
        alert('Please enter a value to update.');
        return;
      }
      try {
        if (!auth.currentUser) {
          alert('No authenticated user found.');
          return;
        }
        const idToken = await auth.currentUser.getIdToken();

        // Prepare update payload
        const payload: any = { uid: selectedUserId };
        if (updateField === 'name') payload.name = updateValue;
        if (updateField === 'role') payload.role = updateValue;
        if (updateField === 'password') payload.password = updateValue;

        const response = await fetch('/api/admin-update-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify(payload),
        });

        const result = await response.json();
        if (!result.success) {
          alert('Failed to update user: ' + result.error);
          return;
        }

        // Fetch the updated user's data for logging
        const updatedUser = allUsers.find(u => u.id === selectedUserId);
        const userIdentifier = updatedUser?.name || updatedUser?.email || selectedUserId;

        // Log the action
        await logAction(
          'update',
          updateField === 'password'
            ? `Changed password for user '${userIdentifier}'`
            : `Updated user '${userIdentifier}': ${updateField} = '${updateValue}'`
        );

        // Show success
        const successDiv = document.createElement('div');
        successDiv.className =
          'fixed bottom-4 right-4 bg-green-500 text-white p-4 rounded-lg shadow-lg flex items-center gap-2 opacity-0 transition-opacity duration-500 z-50';
        successDiv.innerHTML = `
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.586-6.586a2 2 0 00-2.828 0l-10 10a2 2 0 000 2.828l3.172 3.172a2 2 0 002.828 0l10-10a2 2 0 000-2.828z"></path>
          </svg>
          <span>${updateField === 'password' ? 'Password changed successfully!' : 'User updated successfully!'}</span>
        `;
        document.body.appendChild(successDiv);
        setTimeout(() => successDiv.classList.add('opacity-100'), 10);
        setTimeout(() => {
          successDiv.classList.remove('opacity-100');
          setTimeout(() => successDiv.remove(), 500);
        }, 3000);

        setUpdateValue('');
        setSelectedUserId('');
        setUpdateField('name');
      } catch (err) {
        alert('Failed to update user. Please try again.');
        console.error('Error updating user:', err);
      }
    }
  };

  if (loading || !userRole) return null;

  return (
    <div className="relative h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[#1a0a2e] via-[#0d324d] to-[#1d2671] p-3">
      {/* Background shapes */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute rounded-full bg-white/10 w-[12vw] h-[12vw] top-[10%] left-[10%] animate-[float_20s_linear_infinite]" />
        <div className="absolute rounded-full bg-white/10 w-[10vw] h-[10vw] top-[70%] left-[85%] animate-[float_15s_linear_infinite] delay-[-3s]" />
        <div className="absolute rounded-full bg-white/10 w-[7vw] h-[7vw] top-[25%] left-[80%] animate-[float_12s_linear_infinite] delay-[-5s]" />
      </div>

      {/* Back button */}
      <button
        onClick={() => router.push('/')}
        className="absolute top-4 left-4 z-20 bg-white/90 hover:bg-white text-blue-600 p-3 rounded-full shadow-md transition cursor-pointer"
        aria-label="Go back to homepage"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Form Container */}
      <div className="z-10 w-full max-w-md bg-white p-6 rounded-2xl shadow-xl">
        {/* Toggle Buttons */}
        <div className="flex justify-center gap-4 mb-4">
          <button
            type="button"
            onClick={() => setFormMode('create')}
            className={`cursor-pointer px-4 py-2 rounded-lg text-sm font-semibold transition ${
              formMode === 'create' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setFormMode('update')}
            className={`cursor-pointer px-4 py-2 rounded-lg text-sm font-semibold transition ${
              formMode === 'update' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Update
          </button>
        </div>

        {/* Title */}
        <div className="text-center mb-4">
          <h1 className="text-2xl font-bold text-gray-800 flex items-center justify-center gap-2">
            <FaUserPlus className="text-[#f1c40f]" /> {formMode === 'create' ? 'Create New User' : 'Update User'}
          </h1>
          <p className="text-gray-500 text-sm">
            Fill out the form to {formMode === 'create' ? 'add' : 'update'} a user
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {formMode === 'create' ? (
            <>
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  id="name"
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="John Doe"
                  className="w-full p-3 rounded-lg border border-gray-300 text-gray-900 bg-white"
                  required
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input
                  id="email"
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="john@example.com"
                  className="w-full p-3 rounded-lg border border-gray-300 text-gray-900 bg-white"
                  required
                />
              </div>

              <div className="relative">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="••••••••"
                  className="w-full p-3 pr-12 rounded-lg border border-gray-300 text-gray-900 bg-white"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="cursor-pointer absolute top-12 right-3 -translate-y-1/2 text-gray-400 hover:text-blue-500 focus:outline-none"
                >
                  {showPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>

              <div>
                <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  id="role"
                  name="role"
                  value={formData.role}
                  onChange={handleChange}
                  className="w-full p-3 rounded-lg border border-gray-300 text-gray-900 bg-white"
                  required
                >
                  <option value="" disabled>Select a role</option>
                  <option value="admin">Admin</option>
                  <option value="employee">Employee</option>
                </select>
              </div>
            </>
          ) : (
            <>
              {/* UPDATE MODE */}
              {formMode === 'update' && (
                <>
                  {/* User Selector - exclude current user */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Select User</label>
                    <select
                      value={selectedUserId}
                      onChange={e => setSelectedUserId(e.target.value)}
                      className="w-full p-3 rounded-lg border border-gray-300 text-gray-900 bg-white"
                      required
                    >
                      <option value="" disabled>Select a user</option>
                      {allUsers
                        .filter(u => u.id !== user?.uid && u.role !== 'superadmin') // Exclude current user and superadmin
                        .map(u => (
                          <option key={u.id} value={u.id}>
                            {u.name || u.email || u.id}
                          </option>
                        ))}
                    </select>
                  </div>
                  {/* Field Selector - only name and role */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Field to Update</label>
                    <select
                      value={updateField}
                      onChange={e => setUpdateField(e.target.value as any)}
                      className="w-full p-3 rounded-lg border border-gray-300 text-gray-900 bg-white"
                      required
                    >
                      <option value="name">Name</option>
                      <option value="role">Role</option>
                      <option value="password">Password</option>
                    </select>
                  </div>
                  {/* Value Input */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {updateField === 'name' && 'New Name'}
                      {updateField === 'role' && 'New Role'}
                      {updateField === 'password' && 'New Password'}
                    </label>
                    {updateField === 'role' ? (
                      <select
                        value={updateValue}
                        onChange={e => setUpdateValue(e.target.value)}
                        className="w-full p-3 rounded-lg border border-gray-300 text-gray-900 bg-white"
                        required
                      >
                        <option value="" disabled>Select a role</option>
                        <option value="admin">Admin</option>
                        <option value="employee">Employee</option>
                      </select>
                    ) : (
                      <input
                        type={updateField === 'password' ? 'password' : 'text'}
                        value={updateValue}
                        onChange={e => setUpdateValue(e.target.value)}
                        className="w-full p-3 rounded-lg border border-gray-300 text-gray-900 bg-white"
                        required
                      />
                    )}
                  </div>
                </>
              )}
            </>
          )}

          <button
            type="submit"
            className="cursor-pointer w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition duration-200"
          >
            {formMode === 'create' ? 'Create User' : 'Update User'}
          </button>
        </form>
      </div>

      {/* Animations */}
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
        .animate-fadeInDown {
          animation: fadeInDown 0.8s ease forwards;
        }
      `}</style>
    </div>
  );
}
