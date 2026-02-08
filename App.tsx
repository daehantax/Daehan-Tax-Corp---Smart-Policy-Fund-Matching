import React, { useState, useEffect } from 'react';
import { LandingPage } from './pages/LandingPage';
import { Dashboard } from './pages/Dashboard';
import { UserSession } from './types';

function App() {
  const [session, setSession] = useState<UserSession | null>(null);

  // Check for existing session on load (simulated)
  useEffect(() => {
    const savedSession = localStorage.getItem('daehan_session');
    if (savedSession) {
      setSession(JSON.parse(savedSession));
    }
  }, []);

  const handleLogin = (newSession: UserSession) => {
    setSession(newSession);
    localStorage.setItem('daehan_session', JSON.stringify(newSession));
  };

  const handleLogout = () => {
    setSession(null);
    localStorage.removeItem('daehan_session');
  };

  // Simple state-based routing instead of HashRouter for this specific single-flow structure
  // to ensure state persistence is easy to demonstrate
  return (
    <>
      {session ? (
        <Dashboard session={session} onLogout={handleLogout} />
      ) : (
        <LandingPage onLogin={handleLogin} />
      )}
    </>
  );
}

export default App;