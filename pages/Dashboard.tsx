import React, { useState, useEffect, useMemo } from 'react';
import { UserSession, Grant, BizCategory, BizRegions, BizRegionType } from '../types';
import { CsvService } from '../services/csvService';
import { matchesRegion, matchesCategory, scoreAllGrants } from '../services/matchingService';
import { GrantCard } from '../components/GrantCard';
import { Search, Filter, LogOut, Briefcase, RefreshCw, LayoutGrid, Landmark, Cpu, Users, Ship, ShoppingBag, Sprout, Briefcase as ManagementIcon, MoreHorizontal, Heart, Sparkles, CheckCircle2, ListFilter, Phone, Mail, ChevronDown } from 'lucide-react';
import { Button } from '../components/Button';

interface DashboardProps {
  session: UserSession;
  onLogout: () => void;
}

const INTEREST_KEYWORDS = [
  '💰 인건비/고용',
  '🏭 시설/기계구입',
  '📢 마케팅/홍보',
  '🧪 기술개발(R&D)',
  '🚢 수출/해외진출',
  '💵 저금리 대출'
];

// 정렬: 맞춤순(매칭 점수) / 마감임박순(마감일 없는 상시 공고는 뒤로) / 최신등록순
type SortMode = 'match' | 'deadline' | 'recent';
const SORT_LABELS: Record<SortMode, string> = { match: '맞춤순', deadline: '마감임박순', recent: '최신등록순' };

const sortGrants = (list: Grant[], mode: SortMode, scores?: Map<string, { score: number }>): Grant[] => {
  const copy = [...list];
  if (mode === 'match' && scores) {
    copy.sort((a, b) => (scores.get(b.id)?.score || 0) - (scores.get(a.id)?.score || 0));
  } else if (mode === 'recent') {
    copy.sort((a, b) => (b.registrationDate || '').localeCompare(a.registrationDate || ''));
  } else {
    copy.sort((a, b) => {
      if (!a.endDate && !b.endDate) return (b.registrationDate || '').localeCompare(a.registrationDate || '');
      if (!a.endDate) return 1;
      if (!b.endDate) return -1;
      return a.endDate.localeCompare(b.endDate);
    });
  }
  return copy;
};

export const Dashboard: React.FC<DashboardProps> = ({ session, onLogout }) => {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [filteredGrants, setFilteredGrants] = useState<Grant[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Favorites State
  const [favorites, setFavorites] = useState<string[]>(() => {
    const saved = localStorage.getItem('daehan_favorites');
    return saved ? JSON.parse(saved) : [];
  });
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  // ② 직접 조회용 필터 — 맞춤 추천(①)과 별개로, 기본값은 전체
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<BizCategory | '전체'>(BizCategory.ALL);
  const [selectedRegion, setSelectedRegion] = useState<BizRegionType | '전체'>('전체');

  // ① 맞춤 추천용 관심 키워드
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [showInterestSelector, setShowInterestSelector] = useState(true); // Show on first load
  const [recommendLimit, setRecommendLimit] = useState(6);

  const [sortMode, setSortMode] = useState<SortMode>(session.type === 'CLIENT' ? 'match' : 'deadline');
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  // 매칭 점수: 고객사 지역·업종 + 선택한 관심 키워드로 전체 공고 점수화
  const matchScores = useMemo(
    () => scoreAllGrants(grants, session, selectedInterests),
    [grants, session, selectedInterests]
  );

  // ① 맞춤 추천 목록: 다른 지역 전용(점수 0)은 제외, 점수 높은 순
  const recommendedGrants = useMemo(
    () => grants
      .filter(g => (matchScores.get(g.id)?.score || 0) > 0)
      .sort((a, b) => (matchScores.get(b.id)?.score || 0) - (matchScores.get(a.id)?.score || 0)),
    [grants, matchScores]
  );

  // 1. Load Data
  useEffect(() => {
    const loadData = async () => {
      setDataLoading(true);
      const data = await CsvService.getGrantData();
      setGrants(data);
      setFilteredGrants(data);
      setDataLoading(false);
    };
    loadData();

    // 실제 동기화 시각 로드 (없으면 기본 문구 유지)
    fetch('./data/grants_meta.json')
      .then(res => (res.ok ? res.json() : null))
      .then(meta => {
        if (meta?.syncedAt) {
          setSyncedAt(new Date(meta.syncedAt).toLocaleString('ko-KR', {
            month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
          }));
        }
      })
      .catch(() => {});
  }, []);

  // Update LocalStorage whenever favorites change
  useEffect(() => {
    localStorage.setItem('daehan_favorites', JSON.stringify(favorites));
  }, [favorites]);

  const toggleFavorite = (id: string) => {
    setFavorites(prev =>
      prev.includes(id) ? prev.filter(fid => fid !== id) : [...prev, id]
    );
  };

  const toggleInterest = (keyword: string) => {
    setSelectedInterests(prev =>
      prev.includes(keyword)
        ? prev.filter(k => k !== keyword)
        : [...prev, keyword]
    );
  };

  // ② 직접 조회 필터링 (분야·지역·검색·관심공고)
  useEffect(() => {
    if (dataLoading) return;

    let result = grants;

    if (showFavoritesOnly) {
      result = result.filter(g => favorites.includes(g.id));
    } else {
      if (selectedCategory !== BizCategory.ALL) {
        result = result.filter(g => matchesCategory(g, selectedCategory));
      }
      if (selectedRegion !== '전체') {
        result = result.filter(g => matchesRegion(g, selectedRegion));
      }
      if (searchQuery) {
        const q = searchQuery.trim();
        result = result.filter(g =>
          g.title.includes(q) ||
          g.department.includes(q) ||
          g.agency.includes(q) ||
          (g.summary || '').includes(q) ||
          (g.target || '').includes(q)
        );
      }
    }

    setFilteredGrants(sortGrants(result, sortMode, matchScores));
  }, [selectedCategory, selectedRegion, searchQuery, grants, showFavoritesOnly, favorites, dataLoading, sortMode, matchScores]);

  // Counts for UI
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { [BizCategory.ALL]: grants.length };
    Object.values(BizCategory).forEach(cat => {
      if (cat !== BizCategory.ALL) {
        counts[cat] = grants.filter(g => matchesCategory(g, cat)).length;
      }
    });
    return counts;
  }, [grants]);

  const regionCounts = useMemo(() => {
    const counts: Record<string, number> = { '전국': grants.length };
    BizRegions.forEach(reg => {
      if (reg !== '전국') {
        counts[reg] = grants.filter(g => matchesRegion(g, reg)).length;
      }
    });
    return counts;
  }, [grants]);

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case BizCategory.ALL: return <LayoutGrid size={24} />;
      case BizCategory.FINANCE: return <Landmark size={24} />;
      case BizCategory.TECHNOLOGY: return <Cpu size={24} />;
      case BizCategory.MANPOWER: return <Users size={24} />;
      case BizCategory.EXPORT: return <Ship size={24} />;
      case BizCategory.DOMESTIC: return <ShoppingBag size={24} />;
      case BizCategory.STARTUP: return <Sprout size={24} />;
      case BizCategory.MANAGEMENT: return <ManagementIcon size={24} />;
      case BizCategory.ETC: return <MoreHorizontal size={24} />;
      default: return <LayoutGrid size={24} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col relative">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex justify-between items-center">

          {/* [로고 영역] 이미지 로고를 사용하려면 아래 주석을 해제하고 img 태그를 사용하세요 */}
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.location.reload()}>
            {/* 예시: <img src="/logo.png" alt="대한세무법인 로고" className="h-8 w-auto" /> */}
            <div className="bg-blue-900 text-white p-1.5 rounded-lg">
              <Briefcase size={20} />
            </div>
            <span className="font-bold text-xl text-slate-800 tracking-tight">Daehan Tax</span>
            <span className="hidden sm:inline-block text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">고객사 전용</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col text-right">
              <span className="text-sm font-bold text-slate-700">{session.companyName || session.identifier} 대표님</span>
              <span className="text-xs text-slate-400">
                {session.region && <span className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 mr-1">{session.region}</span>}
                {session.industry && <span className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600">{session.industry}</span>}
              </span>
            </div>
            <Button variant="ghost" className="p-2" onClick={onLogout} title="로그아웃">
              <LogOut size={20} />
            </Button>
          </div>
        </div>
      </header>

      {/* Interest Selector Overlay (Like a Wizard) */}
      {showInterestSelector && !dataLoading && (
        <div className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8 relative">
                <div className="text-center mb-8">
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">사장님, 어떤 자금이 가장 필요하신가요?</h2>
                    <p className="text-slate-500">선택하신 키워드와 회사 정보(지역·업종)로 {grants.length.toLocaleString()}개의 공고 중 딱 맞는 사업을 매칭해드립니다.</p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
                    {INTEREST_KEYWORDS.map(keyword => (
                        <button
                            key={keyword}
                            onClick={() => toggleInterest(keyword)}
                            className={`p-4 rounded-xl border-2 text-sm font-bold transition-all flex items-center justify-center gap-2
                                ${selectedInterests.includes(keyword)
                                    ? 'border-blue-600 bg-blue-50 text-blue-800 shadow-md transform scale-105'
                                    : 'border-slate-100 bg-white text-slate-600 hover:border-blue-200 hover:bg-slate-50'
                                }`}
                        >
                            {keyword}
                            {selectedInterests.includes(keyword) && <CheckCircle2 size={16} className="text-blue-600"/>}
                        </button>
                    ))}
                </div>

                <div className="flex gap-3">
                    <Button
                        variant="ghost"
                        fullWidth
                        onClick={() => { setSelectedInterests([]); setShowInterestSelector(false); }}
                        className="text-slate-400 font-normal"
                    >
                        건너뛰기
                    </Button>
                    <Button
                        fullWidth
                        onClick={() => setShowInterestSelector(false)}
                        disabled={selectedInterests.length === 0}
                        className="py-4 text-lg shadow-lg shadow-blue-200"
                    >
                        {selectedInterests.length}개 키워드로 매칭 시작
                    </Button>
                </div>
            </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">

        {/* Loading State */}
        {dataLoading && (
            <div className="py-20 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-900 mx-auto mb-4"></div>
                <p className="text-slate-500">정책자금 데이터를 분석하고 있습니다...</p>
                <p className="text-xs text-slate-400 mt-2">(지역·업종·키워드 매칭 중...)</p>
            </div>
        )}

        {!dataLoading && (
        <>
        {/* ═══════════ ① 우리 회사 맞춤 추천 ═══════════ */}
        <section className="mb-12">
          <div className="bg-gradient-to-br from-blue-900 to-blue-800 rounded-2xl p-6 sm:p-8 shadow-lg text-white mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="bg-white/15 border border-white/20 rounded-lg p-1.5"><Sparkles size={18} /></span>
                  <h2 className="text-xl sm:text-2xl font-bold">
                    {session.companyName ? `${session.companyName} 맞춤 추천` : '우리 회사 맞춤 추천'}
                  </h2>
                </div>
                <p className="text-blue-200 text-sm leading-relaxed">
                  대한세무법인에 등록된 회사 정보(<span className="font-bold text-white">{session.region || '전국'} · {session.industry || '전체 업종'}</span>)와
                  관심 키워드를 바탕으로 <span className="font-bold text-white">자동 매칭</span>한 결과입니다.
                </p>
              </div>
              <div className="text-xs text-blue-200 flex items-center gap-1 shrink-0">
                <RefreshCw size={12} /> 매일 자동 갱신 {syncedAt && `· ${syncedAt}`}
              </div>
            </div>

            {/* 관심 키워드 바 */}
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              {selectedInterests.length > 0 ? (
                selectedInterests.map(tag => (
                  <span key={tag} className="bg-white/15 border border-white/20 text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                    {tag}
                    <button onClick={() => toggleInterest(tag)} className="hover:text-blue-200 ml-0.5"><span className="sr-only">삭제</span>×</button>
                  </span>
                ))
              ) : (
                <span className="text-xs text-blue-300">선택한 관심 키워드가 없습니다 — 지역·업종만으로 매칭 중</span>
              )}
              <button
                onClick={() => setShowInterestSelector(true)}
                className="text-xs text-blue-200 underline hover:text-white ml-1"
              >
                키워드 선택하기
              </button>
            </div>
          </div>

          {recommendedGrants.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {recommendedGrants.slice(0, recommendLimit).map(grant => (
                  <GrantCard
                    key={grant.id}
                    grant={grant}
                    isFavorite={favorites.includes(grant.id)}
                    onToggleFavorite={toggleFavorite}
                    matchReasons={matchScores.get(grant.id)?.reasons}
                  />
                ))}
              </div>
              {recommendedGrants.length > recommendLimit && (
                <div className="text-center mt-6">
                  <Button variant="outline" onClick={() => setRecommendLimit(prev => prev + 6)}>
                    <ChevronDown size={16}/> 추천 더 보기 ({recommendLimit} / {recommendedGrants.length.toLocaleString()}건)
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300">
              <p className="text-slate-400 text-sm">현재 조건에 맞는 추천 공고가 없습니다. 아래에서 전체 공고를 직접 찾아보세요.</p>
            </div>
          )}
        </section>

        {/* ═══════════ ② 전체 공고 직접 찾아보기 ═══════════ */}
        <section>
          <div className="border-t-2 border-slate-200 pt-8 mb-6">
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-slate-800 text-white rounded-lg p-1.5"><ListFilter size={18} /></span>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-800">전체 공고 직접 찾아보기</h2>
            </div>
            <p className="text-slate-500 text-sm">
              위 추천과 별개로, 전체 <span className="font-bold text-slate-700">{grants.length.toLocaleString()}건</span>의 공고를
              분야·지역 버튼과 검색으로 직접 조회하실 수 있습니다.
            </p>
          </div>

          {/* Filter Section 1: Categories */}
          <div className="mb-8">
            <h3 className="text-slate-800 font-bold mb-4 flex items-center gap-2">
              <span className="w-1 h-5 bg-orange-500 rounded-full"></span>
              분야 선택
            </h3>
            <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
              {Object.values(BizCategory).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`flex flex-col items-center gap-2 min-w-[80px] group transition-all duration-200`}
                >
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center border transition-all duration-200 shadow-sm group-hover:shadow-md
                    ${selectedCategory === cat
                      ? 'bg-blue-900 text-white border-blue-900 scale-105'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-500'}`}
                  >
                    {getCategoryIcon(cat)}
                  </div>
                  <span className={`text-sm ${selectedCategory === cat ? 'font-bold text-blue-900' : 'text-slate-600'}`}>
                    {cat}
                    <span className="text-xs text-slate-400 ml-0.5">({categoryCounts[cat] || 0})</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Filter Section 2: Regions */}
          <div className="mb-8">
             <h3 className="text-slate-800 font-bold mb-4 flex items-center gap-2">
              <span className="w-1 h-5 bg-slate-400 rounded-full"></span>
              지역 선택
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedRegion('전체')}
                className={`px-4 py-2 rounded-full text-sm border transition-all duration-200
                  ${selectedRegion === '전체'
                    ? 'bg-slate-800 text-white border-slate-800 shadow-md'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                전체 <span className={`text-xs ml-1 ${selectedRegion === '전체' ? 'text-slate-300' : 'text-slate-400'}`}>({grants.length})</span>
              </button>
              {BizRegions.filter(r => r !== '전국').map((reg) => (
                <button
                  key={reg}
                  onClick={() => setSelectedRegion(reg)}
                  className={`px-4 py-2 rounded-full text-sm border transition-all duration-200
                    ${selectedRegion === reg
                      ? 'bg-slate-800 text-white border-slate-800 shadow-md'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                >
                  {reg} <span className={`text-xs ml-1 ${selectedRegion === reg ? 'text-slate-300' : 'text-slate-400'}`}>({regionCounts[reg] || 0})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Search Bar */}
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                type="text"
                placeholder="공고명, 소관부처, 수행기관 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-900 focus:outline-none shadow-sm"
              />
            </div>

            <button
              onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl border font-bold transition-all
                ${showFavoritesOnly
                  ? 'bg-red-50 border-red-200 text-red-600'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              <Heart size={20} fill={showFavoritesOnly ? "currentColor" : "none"} />
              {showFavoritesOnly ? '전체 공고 보기' : '관심 공고만 보기'}
              <span className={`ml-1 text-xs px-2 py-0.5 rounded-full ${showFavoritesOnly ? 'bg-red-200 text-red-700' : 'bg-slate-100 text-slate-500'}`}>
                {favorites.length}
              </span>
            </button>
          </div>

          {/* Results Info */}
          <div className="mb-4 text-slate-500 text-sm flex justify-between items-center border-b border-slate-200 pb-2">
            <span>
                {showFavoritesOnly ? '관심 공고' : '조회 결과'} <strong className="text-blue-900">{filteredGrants.length.toLocaleString()}</strong> 건
            </span>
            <button
              onClick={() => setSortMode(prev => (prev === 'match' ? 'deadline' : prev === 'deadline' ? 'recent' : 'match'))}
              className="flex items-center gap-1 cursor-pointer hover:text-blue-900 text-xs"
              title="클릭하여 정렬 기준 변경 (맞춤순 → 마감임박순 → 최신등록순)"
            >
              <Filter size={12}/> 정렬: {SORT_LABELS[sortMode]} ▾
            </button>
          </div>

          {/* Grid or Empty State */}
          {filteredGrants.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredGrants.map(grant => (
              <GrantCard
                  key={grant.id}
                  grant={grant}
                  isFavorite={favorites.includes(grant.id)}
                  onToggleFavorite={toggleFavorite}
                  matchReasons={session.type === 'CLIENT' && sortMode === 'match' ? matchScores.get(grant.id)?.reasons : undefined}
              />
              ))}
          </div>
          ) : (
          <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-300">
              {showFavoritesOnly ? (
              <>
                  <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4 text-red-300">
                  <Heart size={32} />
                  </div>
                  <p className="text-slate-500 mb-1 font-bold">저장된 관심 공고가 없습니다.</p>
                  <p className="text-slate-400 mb-4 text-sm">마음에 드는 지원사업의 하트 아이콘을 눌러 저장해보세요.</p>
                  <Button variant="outline" onClick={() => setShowFavoritesOnly(false)}>전체 공고 보러가기</Button>
              </>
              ) : (
              <>
                  <p className="text-slate-400 mb-2">조건에 맞는 공고가 없습니다.</p>
                  <Button variant="ghost" onClick={() => {
                      setSearchQuery('');
                      setSelectedCategory(BizCategory.ALL);
                      setSelectedRegion('전체');
                  }}>필터 초기화</Button>
              </>
              )}
          </div>
          )}
        </section>
        </>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-8 mt-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-xs text-slate-400">
          <p className="font-bold text-slate-500 mb-1">대한세무법인</p>
          <p>경기 성남시 분당구 성남대로 912 BYC빌딩 501호·515호</p>
          <p className="mt-1 flex items-center justify-center gap-3">
            <a href="tel:031-783-8877" className="flex items-center gap-1 text-slate-500 hover:text-blue-900"><Phone size={11}/> 031-783-8877</a>
            <a href="mailto:tax@taxdh.net" className="flex items-center gap-1 text-slate-500 hover:text-blue-900"><Mail size={11}/> tax@taxdh.net</a>
          </p>
          <p className="mt-2">회사 장부 및 기타 문의는 언제든 환영합니다 · © 2026 Daehan Tax Corp. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};
