import React, { useState, useEffect } from 'react';
import { LandingPage } from './pages/LandingPage';
import { Dashboard } from './pages/Dashboard';
import { UserSession } from './types';

// 저장된 세션의 구조 버전. UserSession 에 필드를 추가·변경하면 이 숫자를 올린다.
// 그러면 예전 구조로 저장된 세션은 버려지고 다시 조회하게 된다.
//   왜 필요한가: 세션을 localStorage 에 그대로 넣어 두었더니, bizType(업태)을 추가했을 때
//   이미 로그인해 둔 브라우저는 계속 옛 세션을 복원해 업태 배지가 비어 있었다.
//   구조를 바꿀 때마다 고객사가 직접 로그아웃해야 하는 상황은 피해야 한다.
const SESSION_VERSION = 5;   // 3: bizItem·isYouthOwner·isFemaleOwner / 4: clientType 추가 / 5: ceoName 제거
const SESSION_KEY = 'daehan_session';

function App() {
  const [session, setSession] = useState<UserSession | null>(null);

  // Check for existing session on load (simulated)
  useEffect(() => {
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (parsed?.v === SESSION_VERSION && parsed.session) {
        setSession(parsed.session);
      } else {
        localStorage.removeItem(SESSION_KEY);   // 옛 구조 — 버리고 다시 조회하게 한다
      }
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }, []);

  const handleLogin = (newSession: UserSession) => {
    setSession(newSession);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ v: SESSION_VERSION, session: newSession }));
  };

  const handleLogout = () => {
    setSession(null);
    localStorage.removeItem(SESSION_KEY);
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