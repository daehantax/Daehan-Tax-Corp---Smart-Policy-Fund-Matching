import React, { useState, useEffect, useMemo } from 'react';
import { UserSession, Grant, BizCategory, BizRegions, BizRegionType } from '../types';
import { CsvService } from '../services/csvService'; 
import { GrantCard } from '../components/GrantCard';
import { ConsultationModal } from '../components/ConsultationModal';
import { Search, Filter, Bell, LogOut, Briefcase, RefreshCw, LayoutGrid, Landmark, Cpu, Users, Ship, ShoppingBag, Sprout, Briefcase as ManagementIcon, MoreHorizontal, Heart, Lightbulb, CheckCircle2 } from 'lucide-react';
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

// 지역 매칭: 기업마당 해시태그(정밀) 우선, 없으면 기존 문자열 포함 방식으로 폴백
// (해시태그는 '전남광주'처럼 통합 표기가 있어 부분 일치로 비교)
const matchesRegion = (g: Grant, region: string): boolean => {
  if (region === '전체' || region === '전국') return true;
  if (g.hashtags && g.hashtags.length > 0 && g.hashtags.some(h => h.includes(region) || region.includes(h))) {
    return true;
  }
  return g.department.includes(region) || g.title.includes(region) || g.agency.includes(region);
};

// 분야 매칭: 대분류에 더해 중분류까지 확인
const matchesCategory = (g: Grant, cat: string): boolean => {
  if (cat === '전체') return true;
  return g.category.includes(cat) || (g.subCategory || '').includes(cat);
};

// 정렬: 마감임박순(마감일 없는 상시 공고는 뒤로) / 최신등록순
const sortGrants = (list: Grant[], mode: 'deadline' | 'recent'): Grant[] => {
  const copy = [...list];
  if (mode === 'recent') {
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

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<BizCategory | '전체'>(
    (session.industry as BizCategory) || BizCategory.ALL
  );
  const [selectedRegion, setSelectedRegion] = useState<BizRegionType | '전체'>(
    (session.region as BizRegionType) || '전체'
  );

  // Interest Keywords (New Feature)
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [showInterestSelector, setShowInterestSelector] = useState(true); // Show on first load

  const [isRecommendationMode, setIsRecommendationMode] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedGrant, setSelectedGrant] = useState<Grant | null>(null);
  const [sortMode, setSortMode] = useState<'deadline' | 'recent'>('deadline');
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  // 1. Load Data
  useEffect(() => {
    const loadData = async () => {
      setDataLoading(true);
      const data = await CsvService.getGrantData();
      setGrants(data);
      // Don't set filteredGrants here immediately if we want to show the selector first
      setFilteredGrants(data);
      setDataLoading(false);
    };
    loadData();

    // 실제 동기화 시각 로드 (없으면 배너에 기본 문구 유지)
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

  // Filter Logic with Smart Fallback & Interest Matching
  useEffect(() => {
    if (dataLoading) return; 

    let result = grants;

    // 0. Keyword/Interest Filter (Priority)
    if (selectedInterests.length > 0) {
        result = result.filter(g => {
            // If grant has tags, check if any overlap with selectedInterests
            if (g.tags && g.tags.length > 0) {
                return g.tags.some(tag => selectedInterests.includes(tag));
            }
            return false;
        });
    }

    // 1. Basic Filtering
    if (showFavoritesOnly) {
      result = result.filter(g => favorites.includes(g.id));
    } else {
      // Normal filtering
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

    // 2. Smart Fallback
    if (result.length === 0 && !showFavoritesOnly && !searchQuery && grants.length > 0) {
      setIsRecommendationMode(true);
      const recommendations = grants.filter(g => {
         const catMatch = selectedCategory === BizCategory.ALL ? true : matchesCategory(g, selectedCategory);
         const regionMatch = selectedRegion === '전체' ? true : (g.department.includes('전국') || g.department.includes('중소벤처기업부') || matchesRegion(g, selectedRegion));
         return catMatch && regionMatch;
      });
      setFilteredGrants(sortGrants(recommendations.length > 0 ? recommendations : grants.slice(0, 6), sortMode));
    } else {
      setIsRecommendationMode(false);
      setFilteredGrants(sortGrants(result, sortMode));
    }

  }, [selectedCategory, selectedRegion, searchQuery, grants, showFavoritesOnly, favorites, dataLoading, selectedInterests, sortMode]);

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

  const handleConsult = (grant: Grant) => {
    setSelectedGrant(grant);
    setIsModalOpen(true);
  };

  const getLastMonday = () => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const lastMonday = new Date(d.setDate(diff));
    return lastMonday.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  };

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
            
            {/* 현재 기본 로고 (아이콘 + 텍스트) */}
            <div className="bg-blue-900 text-white p-1.5 rounded-lg">
              <Briefcase size={20} />
            </div>
            <span className="font-bold text-xl text-slate-800 tracking-tight">Daehan Tax <span className="text-xs font-normal text-slate-500">for BizInfo</span></span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col text-right">
              <span className="text-xs text-slate-400">
                {session.companyName || 'Google Drive Linked'}
                {session.region && <span className="ml-1 px-1.5 py-0.5 bg-slate-100 rounded text-slate-600">{session.region}</span>}
              </span>
              <span className="text-sm font-bold text-slate-700">{session.ceoName || session.identifier} 님</span>
            </div>
            <Button variant="ghost" className="p-2" onClick={onLogout}>
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
                    <p className="text-slate-500">선택하신 키워드를 분석하여 {grants.length.toLocaleString()}개의 공고 중 최적의 사업을 매칭해드립니다.</p>
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
                        건너뛰기 (전체보기)
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
        
        {/* Banner */}
        <div className="bg-white border-l-4 border-blue-900 rounded-r-lg p-4 shadow-sm mb-8 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Bell size={18} className="text-blue-900" />
              맞춤형 정책자금 매칭 리포트
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              기업마당 공고 데이터가 동기화 되었습니다. (업데이트: {syncedAt || getLastMonday()})
            </p>
          </div>
          <div className="text-xs text-slate-400 flex items-center gap-1">
            <RefreshCw size={12} /> Auto-Sync Active
          </div>
        </div>

        {/* Selected Interests Bar (If any) */}
        {selectedInterests.length > 0 && (
            <div className="mb-6 flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-slate-700 mr-2">선택한 관심분야:</span>
                {selectedInterests.map(tag => (
                    <span key={tag} className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                        {tag}
                        <button onClick={() => toggleInterest(tag)} className="hover:text-blue-600"><span className="sr-only">삭제</span>×</button>
                    </span>
                ))}
                <button 
                    onClick={() => setShowInterestSelector(true)} 
                    className="text-xs text-slate-400 underline ml-2 hover:text-blue-600"
                >
                    키워드 다시 선택하기
                </button>
            </div>
        )}

        {/* Filter Section 1: Categories */}
        <div className="mb-8">
          <h3 className="text-slate-800 font-bold mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-orange-500 rounded-full"></span>
            분야별 조회 <span className="text-orange-500 text-sm font-normal">({grants.length})</span>
          </h3>
          <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
            {Object.values(BizCategory).map((cat) => (
              <button
                key={cat}
                onClick={() => { setSelectedCategory(cat); setIsRecommendationMode(false); }}
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
            지역별 조회
          </h3>
          <div className="flex flex-wrap gap-2">
            {BizRegions.map((reg) => (
              <button
                key={reg}
                onClick={() => { setSelectedRegion(reg); setIsRecommendationMode(false); }}
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
          <div className="flex items-center gap-2">
            <span>
                {showFavoritesOnly ? '관심 공고' : '검색결과'} <strong className="text-blue-900">{filteredGrants.length}</strong> 건
            </span>
            {isRecommendationMode && (
                <span className="flex items-center gap-1 bg-yellow-100 text-yellow-800 text-xs px-2 py-0.5 rounded-full font-bold animate-pulse">
                    <Lightbulb size={12} /> 맞춤형 추천 결과
                </span>
            )}
          </div>
          <button
            onClick={() => setSortMode(prev => (prev === 'deadline' ? 'recent' : 'deadline'))}
            className="flex items-center gap-1 cursor-pointer hover:text-blue-900 text-xs"
            title="클릭하여 정렬 기준 변경"
          >
            <Filter size={12}/> 정렬: {sortMode === 'deadline' ? '마감임박순' : '최신등록순'} ▾
          </button>
        </div>
        
        {/* Loading State */}
        {dataLoading && (
            <div className="py-20 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-900 mx-auto mb-4"></div>
                <p className="text-slate-500">정책자금 데이터를 분석하고 있습니다...</p>
                <p className="text-xs text-slate-400 mt-2">(AI Keyword Matching...)</p>
            </div>
        )}

        {/* Grid or Empty State */}
        {!dataLoading && (
            <>
                {isRecommendationMode && (
                    <div className="mb-6 bg-blue-50 border border-blue-200 p-4 rounded-xl flex items-start gap-3">
                        <Lightbulb className="text-blue-600 shrink-0 mt-0.5" size={20} />
                        <div>
                            <h4 className="font-bold text-blue-900 text-sm mb-1">
                                사장님({selectedRegion}/{selectedCategory})께 딱 맞는 조건의 공고가 현재 없습니다.
                            </h4>
                            <p className="text-blue-700 text-sm">
                                대신, <span className="font-bold underline">전국 규모의 지원사업</span>이나 사장님과 <span className="font-bold underline">유사한 업종</span>의 인기 공고를 AI가 찾아보았습니다!
                            </p>
                        </div>
                    </div>
                )}

                {filteredGrants.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredGrants.map(grant => (
                    <GrantCard 
                        key={grant.id} 
                        grant={grant} 
                        onConsult={handleConsult} 
                        userIndustry={session.industry}
                        isFavorite={favorites.includes(grant.id)}
                        onToggleFavorite={toggleFavorite}
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
                            setSelectedInterests([]);
                            setIsRecommendationMode(false);
                        }}>전체 보기</Button>
                    </>
                    )}
                </div>
                )}
            </>
        )}
      </main>

      <ConsultationModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        grant={selectedGrant} 
      />
    </div>
  );
};