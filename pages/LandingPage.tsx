import React, { useState } from 'react';
import { Button } from '../components/Button';
import { UserSession } from '../types';
import { MockDbService } from '../services/mockDb';
import { ShieldCheck, TrendingUp, ArrowRight, Building2, AlertCircle, Phone, Mail, Sparkles, MapPin, RefreshCw } from 'lucide-react';

interface LandingPageProps {
  onLogin: (session: UserSession) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onLogin }) => {
  const [brn, setBrn] = useState('');
  const [ceoName, setCeoName] = useState('');
  const [loading, setLoading] = useState(false);
  // 실패 종류. '고객사 아님'과 '시스템 오류'는 문구가 달라야 한다 —
  // 오류를 "고객사 아님"으로 보여주면 실제 고객사가 혼란스러워한다.
  const [failure, setFailure] = useState<'not_found' | 'rate_limited' | 'error' | null>(null);

  const clearFailure = () => setFailure(null);

  // Client Login Handler
  const handleClientLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setFailure(null);

    const result = await MockDbService.verifyClient(brn, ceoName);

    if (result.status === 'ok') {
      onLogin(result.session);
    } else {
      setFailure(result.status);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Hero Section */}
      <div className="bg-blue-900 text-white pt-16 pb-24 px-4 rounded-b-[3rem] shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-12 opacity-10">
          <Building2 size={300} />
        </div>
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <span className="inline-block bg-blue-800/70 border border-blue-400/30 text-blue-100 text-xs font-bold px-4 py-1.5 rounded-full mb-5 tracking-wide">
            대한세무법인 고객사 전용 서비스
          </span>
          <h1 className="text-3xl md:text-5xl font-bold mb-6 leading-tight">
            대한세무법인<br/>
            <span className="text-blue-300">맞춤형 정책자금</span> 스마트 매칭
          </h1>
          <p className="text-blue-100 text-lg md:text-xl mb-8 max-w-2xl mx-auto">
            매일 업데이트되는 정부지원 사업.<br/>
            고객님의 업종과 지역 조건에 맞는 정부지원을 찾아드립니다.
          </p>
          <div className="flex justify-center gap-4 text-sm text-blue-200">
            <span className="flex items-center gap-1"><ShieldCheck size={16}/> 검증된 데이터</span>
            <span className="flex items-center gap-1"><TrendingUp size={16}/> 매일 자동 갱신</span>
          </div>
        </div>
      </div>

      {/* Main Card */}
      <div className="max-w-2xl mx-auto w-full -mt-16 px-4 mb-12 relative z-20">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
          <div className="p-8">
            <div className="animate-fadeIn">
              <h2 className="text-xl font-bold text-slate-800 mb-2 flex items-center gap-2">
                고객사 전용 조회
                <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">MEMBERS ONLY</span>
              </h2>
              <p className="text-slate-500 mb-6 text-sm">
                대한세무법인과 함께하시는 고객사는 <span className="font-bold text-slate-700">사업자번호와 대표자 성함</span>만
                입력하시면 회사의 지역·업종 정보에 맞춰 자동 매칭된 결과를 받아보실 수 있습니다.
              </p>

              <form onSubmit={handleClientLogin} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">사업자 등록번호</label>
                  <input
                    type="text"
                    value={brn}
                    onChange={(e) => { setBrn(e.target.value); clearFailure(); }}
                    placeholder="000-00-00000"
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:outline-none transition-all text-lg tracking-wider font-mono
                      ${failure === 'not_found' ? 'border-red-300 focus:ring-red-200 bg-red-50' : 'border-slate-300 focus:ring-blue-900 focus:border-blue-900'}`}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">대표자 성명</label>
                  <input
                    type="text"
                    value={ceoName}
                    onChange={(e) => { setCeoName(e.target.value); clearFailure(); }}
                    placeholder="홍길동"
                    autoComplete="off"
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:outline-none transition-all text-lg
                      ${failure === 'not_found' ? 'border-red-300 focus:ring-red-200 bg-red-50' : 'border-slate-300 focus:ring-blue-900 focus:border-blue-900'}`}
                  />
                  <p className="text-xs text-slate-400 mt-2">
                    공동사업자는 대표자 중 한 분의 성함을 입력하시면 됩니다.
                  </p>
                </div>

                {/* 미등록 안내 — 사업자번호·대표자 성명 중 어느 쪽이 틀렸는지는 구분해 알리지 않는다.
                    구분해 주면 "번호는 맞다"는 사실이 새어나가 고객사 명단 확인 수단이 된다. */}
                {failure === 'not_found' && (
                  <div className="p-5 bg-slate-50 rounded-xl border border-slate-200 animate-fadeIn">
                    <div className="flex items-start gap-3 mb-4">
                       <AlertCircle className="text-orange-500 shrink-0 mt-0.5" size={20} />
                       <div className="text-sm">
                         <p className="font-bold text-slate-800 mb-1">등록된 고객사 정보가 없습니다.</p>
                         <p className="text-slate-600 leading-relaxed">
                           이 서비스는 <span className="text-blue-900 font-bold">대한세무법인 고객사</span>에게만
                           제공되는 전용 혜택입니다.<br/>
                           함께하고 싶으시다면 부담 없이 문의해 주세요 — 기장 상담과 함께
                           정책자금 매칭도 안내해 드립니다.
                         </p>
                       </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <a href="tel:031-783-8877" className="flex-1 flex items-center justify-center gap-2 h-11 rounded-lg bg-blue-900 text-white text-sm font-bold hover:bg-blue-800 transition-colors">
                        <Phone size={15}/> 031-783-8877
                      </a>
                      <a href="mailto:tax@taxdh.net" className="flex-1 flex items-center justify-center gap-2 h-11 rounded-lg border border-slate-300 text-slate-700 text-sm font-bold hover:bg-slate-100 transition-colors">
                        <Mail size={15}/> tax@taxdh.net
                      </a>
                    </div>
                  </div>
                )}

                {/* 시스템 오류 · 호출 제한 — "고객사 아님"과 문구를 다르게 한다 */}
                {(failure === 'error' || failure === 'rate_limited') && (
                  <div className="p-5 bg-amber-50 rounded-xl border border-amber-200 animate-fadeIn">
                    <div className="flex items-start gap-3 mb-4">
                      <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={20} />
                      <div className="text-sm">
                        {failure === 'rate_limited' ? (
                          <>
                            <p className="font-bold text-slate-800 mb-1">조회 시도가 너무 많습니다.</p>
                            <p className="text-slate-600 leading-relaxed">
                              1분 정도 기다린 뒤 다시 시도해 주세요.
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="font-bold text-slate-800 mb-1">일시적인 오류입니다.</p>
                            <p className="text-slate-600 leading-relaxed">
                              잠시 후 다시 시도해 주세요. 계속 같은 화면이 나오면 아래로 연락 주시면
                              바로 확인해 드리겠습니다.
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <a href="tel:031-783-8877" className="flex-1 flex items-center justify-center gap-2 h-11 rounded-lg bg-blue-900 text-white text-sm font-bold hover:bg-blue-800 transition-colors">
                        <Phone size={15}/> 031-783-8877
                      </a>
                      <a href="mailto:tax@taxdh.net" className="flex-1 flex items-center justify-center gap-2 h-11 rounded-lg border border-slate-300 text-slate-700 text-sm font-bold hover:bg-slate-100 transition-colors">
                        <Mail size={15}/> tax@taxdh.net
                      </a>
                    </div>
                  </div>
                )}

                {!failure && (
                  <div className="text-xs text-slate-400">
                    * 입력하신 정보는 조회 목적으로만 사용하며 별도로 보관하지 않습니다.
                    부정 사용 방지를 위해 접속 기록은 일정 기간 보관됩니다.
                  </div>
                )}

                <Button type="submit" fullWidth disabled={loading || !brn.trim() || !ceoName.trim()} className="py-4 text-lg">
                    {loading ? '조회 중...' : <>나의 맞춤 지원금 조회하기 <ArrowRight size={18}/></>}
                </Button>
              </form>
            </div>
          </div>
        </div>

        {/* 고객사 전용 혜택 안내 (은근한 소개 마케팅) */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
            <MapPin className="mx-auto text-blue-900 mb-2" size={20} />
            <p className="text-xs font-bold text-slate-700 mb-1">지역·업종 자동 매칭</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">등록된 회사 정보 기준으로<br/>맞는 공고만 골라드립니다</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
            <RefreshCw className="mx-auto text-blue-900 mb-2" size={20} />
            <p className="text-xs font-bold text-slate-700 mb-1">매일 자동 갱신</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">기업마당 신규 공고를<br/>매일 아침 반영합니다</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
            <Sparkles className="mx-auto text-blue-900 mb-2" size={20} />
            <p className="text-xs font-bold text-slate-700 mb-1">고객사만의 혜택</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">대한세무법인 고객사에게<br/>무료로 제공됩니다</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-slate-400 text-xs pb-10 px-4 mt-auto">
        <p className="font-bold text-slate-500 mb-1">대한세무법인</p>
        <p>경기 성남시 분당구 성남대로 912 BYC빌딩 501호·515호</p>
        <p className="mt-1">회사 장부 및 기타 문의 <a href="tel:031-783-8877" className="text-slate-500 hover:text-blue-900">031-783-8877</a> | <a href="mailto:tax@taxdh.net" className="text-slate-500 hover:text-blue-900">tax@taxdh.net</a></p>
        <p className="mt-2">© 2026 Daehan Tax Corp. All rights reserved.</p>
      </div>
    </div>
  );
};
