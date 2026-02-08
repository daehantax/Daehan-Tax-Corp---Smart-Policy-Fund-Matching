import React, { useState } from 'react';
import { Button } from '../components/Button';
import { GeneralInquiry, UserSession } from '../types';
import { MockDbService } from '../services/mockDb';
import { ShieldCheck, Users, ArrowRight, Building2, TrendingUp, AlertCircle, Briefcase } from 'lucide-react';
import { MOCK_CLIENT_DB } from '../constants';

interface LandingPageProps {
  onLogin: (session: UserSession) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onLogin }) => {
  const [activeTab, setActiveTab] = useState<'CLIENT' | 'GUEST'>('CLIENT');
  const [brn, setBrn] = useState('');
  const [loading, setLoading] = useState(false);
  const [clientNotFound, setClientNotFound] = useState(false); // New state for specific error flow

  // General Inquiry Form State
  const [inquiryForm, setInquiryForm] = useState<GeneralInquiry>({
    name: '',
    contact: '',
    email: '',
    industry: '',
    requestDetails: ''
  });
  const [inquirySuccess, setInquirySuccess] = useState(false);

  // Client Login Handler
  const handleClientLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setClientNotFound(false);

    // Call service to verify against Mock CSV DB
    const session = await MockDbService.verifyClient(brn);
    
    if (session) {
      onLogin(session);
    } else {
      setClientNotFound(true); // Trigger the special UI
    }
    setLoading(false);
  };

  // Switch to Guest Tab handler
  const switchToGuestMode = () => {
    setClientNotFound(false);
    setActiveTab('GUEST');
    // Smooth scroll to top of form if needed, or just focus
  };

  // General Inquiry Handler
  const handleInquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    // Save to Google Sheet (Mocked)
    const success = await MockDbService.submitInquiry(inquiryForm);
    
    setLoading(false);
    if (success) {
        setInquirySuccess(true);
    } else {
        alert('접수 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  const handleInquiryChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setInquiryForm({ ...inquiryForm, [e.target.name]: e.target.value });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Hero Section */}
      <div className="bg-blue-900 text-white pt-16 pb-24 px-4 rounded-b-[3rem] shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-12 opacity-10">
          <Building2 size={300} />
        </div>
        <div className="max-w-4xl mx-auto text-center relative z-10 flex flex-col items-center">
          
          {/* Logo in Hero */}
          <div className="mb-6 p-2 bg-white/10 rounded-2xl backdrop-blur-sm inline-block">
             <img 
                src="/logo.png" 
                alt="대한세무법인" 
                className="h-16 w-auto object-contain" 
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
             />
          </div>

          <h1 className="text-3xl md:text-5xl font-bold mb-6 leading-tight">
            대한세무법인<br/>
            <span className="text-blue-300">맞춤형 정책자금</span> 스마트 매칭
          </h1>
          <p className="text-blue-100 text-lg md:text-xl mb-8 max-w-2xl mx-auto">
            매주 월요일 업데이트되는 2만여 개의 정부지원 사업.<br/>
            고객님의 업종과 조건에 딱 맞는 자금을 AI가 찾아드립니다.
          </p>
          <div className="flex justify-center gap-4 text-sm text-blue-200">
            <span className="flex items-center gap-1"><ShieldCheck size={16}/> 검증된 데이터</span>
            <span className="flex items-center gap-1"><TrendingUp size={16}/> 매주 자동 갱신</span>
            <span className="flex items-center gap-1"><Users size={16}/> 전문가 상시 매칭</span>
          </div>
        </div>
      </div>

      {/* Main Card */}
      <div className="max-w-2xl mx-auto w-full -mt-16 px-4 mb-20 relative z-20">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
          {/* Tabs */}
          <div className="flex border-b border-slate-200">
            <button 
              onClick={() => { setActiveTab('CLIENT'); setClientNotFound(false); }}
              className={`flex-1 py-4 text-center font-bold text-lg transition-colors
                ${activeTab === 'CLIENT' ? 'bg-white text-blue-900 border-b-2 border-blue-900' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
            >
              고객사 로그인
            </button>
            <button 
              onClick={() => setActiveTab('GUEST')}
              className={`flex-1 py-4 text-center font-bold text-lg transition-colors
                ${activeTab === 'GUEST' ? 'bg-white text-blue-900 border-b-2 border-blue-900' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
            >
              일반 상담 신청
            </button>
          </div>

          <div className="p-8">
            {activeTab === 'CLIENT' ? (
              <div className="animate-fadeIn">
                <h2 className="text-xl font-bold text-slate-800 mb-2">고객사 전용 조회</h2>
                <p className="text-slate-500 mb-6 text-sm">대한세무법인 기장 고객사는 사업자번호로 즉시 조회가 가능합니다.</p>
                
                <form onSubmit={handleClientLogin} className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">사업자 등록번호</label>
                    <input 
                      type="text" 
                      value={brn}
                      onChange={(e) => { setBrn(e.target.value); setClientNotFound(false); }}
                      placeholder="000-00-00000"
                      className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:outline-none transition-all text-lg tracking-wider font-mono
                        ${clientNotFound ? 'border-red-300 focus:ring-red-200 bg-red-50' : 'border-slate-300 focus:ring-blue-900 focus:border-blue-900'}`}
                    />
                    
                    {/* Failure Scenario UI */}
                    {clientNotFound && (
                      <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200 animate-fadeIn">
                        <div className="flex items-start gap-3 mb-3">
                           <AlertCircle className="text-orange-500 shrink-0 mt-0.5" size={20} />
                           <div className="text-sm">
                             <p className="font-bold text-slate-800 mb-1">등록된 고객사 정보가 없습니다.</p>
                             <p className="text-slate-600 leading-relaxed">
                               이 서비스는 <span className="text-blue-900 font-bold">대한세무법인 거래처</span>에게만 지원됩니다.<br/>
                               아래 버튼을 눌러 무료 상담을 신청해주시면 감사합니다. ^^
                             </p>
                           </div>
                        </div>
                        <Button 
                          type="button" 
                          variant="secondary" 
                          fullWidth 
                          onClick={switchToGuestMode}
                          className="mt-2"
                        >
                          <Briefcase size={18} /> 무료 매칭 상담 신청하기
                        </Button>
                      </div>
                    )}

                    {!clientNotFound && (
                        <div className="text-xs text-slate-400 mt-2">
                          * CSV 데이터 연동 완료 (dhadress_processed_data_20260125_182336.csv)
                        </div>
                    )}
                  </div>
                  
                  {!clientNotFound && (
                    <Button type="submit" fullWidth disabled={loading} className="py-4 text-lg">
                        {loading ? '조회 중...' : '나의 맞춤 지원금 조회하기'}
                    </Button>
                  )}
                </form>
              </div>
            ) : (
              <div className="animate-fadeIn">
                {!inquirySuccess ? (
                  <>
                    <h2 className="text-xl font-bold text-slate-800 mb-2">무료 매칭 상담 신청</h2>
                    <p className="text-slate-500 mb-6 text-sm">정보를 남겨주시면 업종에 맞는 지원금을 메일로 보내드립니다.</p>
                    
                    <form onSubmit={handleInquirySubmit} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-slate-600 mb-1">성함/직함</label>
                          <input required name="name" onChange={handleInquiryChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-900 focus:outline-none" placeholder="홍길동 대표" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-600 mb-1">연락처</label>
                          <input required name="contact" onChange={handleInquiryChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-900 focus:outline-none" placeholder="010-0000-0000" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">이메일</label>
                        <input required type="email" name="email" onChange={handleInquiryChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-900 focus:outline-none" placeholder="email@company.com" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">업종</label>
                        <select required name="industry" onChange={handleInquiryChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-900 focus:outline-none bg-white">
                          <option value="">선택해주세요</option>
                          <option value="제조업">제조업</option>
                          <option value="도소매">도소매</option>
                          <option value="서비스/IT">서비스/IT</option>
                          <option value="건설업">건설업</option>
                          <option value="기타">기타</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">요청사항</label>
                        <textarea required name="requestDetails" onChange={handleInquiryChange} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-900 focus:outline-none h-20" placeholder="예: 고용지원금이 필요합니다." />
                      </div>
                      <Button type="submit" fullWidth disabled={loading}>
                        {loading ? '구글 시트로 접수하기' : '매칭 리포트 신청하기'}
                      </Button>
                    </form>
                  </>
                ) : (
                  <div className="text-center py-10">
                    <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
                      <ShieldCheck size={40} className="text-blue-600" />
                    </div>
                    <h3 className="text-2xl font-bold text-slate-900 mb-2">접수가 완료되었습니다</h3>
                    <p className="text-slate-600 mb-8">담당자가 내용을 확인 후<br/>최적의 자금 매칭 리포트를 보내드립니다.</p>
                    <Button onClick={() => window.location.reload()} variant="outline">처음으로 돌아가기</Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Footer info in landing */}
        <div className="text-center text-slate-400 text-xs">
          <p>© 2024 Daehan Tax Corp. All rights reserved.</p>
          <p className="mt-1">고객센터: 1588-0000 | 서울시 강남구 테헤란로</p>
        </div>
      </div>
    </div>
  );
};