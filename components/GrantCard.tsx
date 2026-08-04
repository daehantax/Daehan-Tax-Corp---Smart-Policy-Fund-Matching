import React from 'react';
import { Grant, BizCategory } from '../types';
import { Building2, ExternalLink, Clock, Heart, Tag, MapPin, CheckCircle2, AlertTriangle } from 'lucide-react';
import { getGrantRegions, getGrantSigungu } from '../services/matchingService';
import { EXCLUSIVE_ZONES } from '../services/geo';

interface GrantCardProps {
  grant: Grant;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  matchReasons?: string[]; // 고객사 로그인 시 매칭 근거 표시 (맞춤순)
  warnings?: string[];     // 업종이 안 맞아 보이는 점 (제외하지 않고 주의만 표시)
}

export const GrantCard: React.FC<GrantCardProps> = ({
  grant,
  isFavorite,
  onToggleFavorite,
  matchReasons,
  warnings
}) => {
  // Helper for category badge color
  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case BizCategory.FINANCE: return 'bg-green-100 text-green-700';
      case BizCategory.TECHNOLOGY: return 'bg-purple-100 text-purple-700';
      case BizCategory.MANPOWER: return 'bg-orange-100 text-orange-700';
      case BizCategory.EXPORT: return 'bg-blue-100 text-blue-700';
      case BizCategory.STARTUP: return 'bg-pink-100 text-pink-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  // 지역 표시: 전국이면 '전국', 아니면 해당 지역 나열 (최대 3개).
  // 시·군 전용 사업이면 "경기 화성시"처럼 시·군까지 붙여 관내 사업임을 드러낸다.
  const regions = getGrantRegions(grant);
  const sigungu = getGrantSigungu(grant);
  const zone = regions.find(r => EXCLUSIVE_ZONES[r]);   // '비수도권' 등
  const regionLabel = zone ? zone
    : regions.includes('전국') ? '전국'
    : regions.slice(0, 3).join('·');
  const placeLabel = sigungu.length > 0
    ? `${regionLabel} ${sigungu.slice(0, 2).join('·')}`
    : regionLabel;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-all duration-300 hover:-translate-y-1 overflow-hidden flex flex-col h-full group relative">
      <div className="p-6 flex-1">
        {/* Top Meta */}
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-1.5">
            <span className={`px-2.5 py-1 rounded-md text-[11px] font-bold ${getCategoryColor(grant.category)}`}>
              {grant.category}
            </span>
            <span className="inline-flex items-center gap-0.5 px-2 py-1 rounded-md text-[11px] font-bold bg-sky-50 text-sky-700">
              <MapPin size={11} /> {placeLabel}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="block text-[10px] text-slate-400">등록: {grant.registrationDate}</span>
            <button
              onClick={() => onToggleFavorite(grant.id)}
              className={`p-1.5 rounded-full transition-colors ${isFavorite ? 'bg-red-50 text-red-500' : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500'}`}
              title={isFavorite ? "관심 공고 삭제" : "관심 공고 저장"}
            >
              <Heart size={18} fill={isFavorite ? "currentColor" : "none"} />
            </button>
          </div>
        </div>

        {/* Title */}
        <h3 className="text-lg font-bold text-slate-800 mb-3 line-clamp-2 leading-snug min-h-[3.5rem] group-hover:text-blue-900 transition-colors">
          {grant.title}
        </h3>

        {/* 매칭 근거 + 주의 (고객사 로그인 + 맞춤순일 때) */}
        {((matchReasons && matchReasons.length > 0) || (warnings && warnings.length > 0)) && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {(matchReasons || []).map((reason, idx) => (
              <span key={`r${idx}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                <CheckCircle2 size={11} /> {reason}
              </span>
            ))}
            {(warnings || []).map((warning, idx) => (
              <span key={`w${idx}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                <AlertTriangle size={11} /> {warning}
              </span>
            ))}
          </div>
        )}

        {/* Org Info */}
        <div className="flex items-center gap-2 mb-2 text-xs text-slate-500">
           <Building2 size={14} className="text-slate-400"/>
           <span className="font-medium text-slate-700">{grant.department}</span>
           <span className="w-[1px] h-3 bg-slate-300"></span>
           <span className="truncate max-w-[120px]">{grant.agency}</span>
        </div>

        {/* 지원대상 (기업마당 데이터) */}
        {grant.target && (
          <div className="flex items-start gap-1.5 mb-2 text-xs text-slate-500">
            <Tag size={13} className="text-slate-400 mt-0.5 shrink-0"/>
            <span className="line-clamp-1"><span className="text-slate-400">대상</span> <span className="text-slate-600">{grant.target}</span></span>
          </div>
        )}

        {/* 사업개요 (기업마당 데이터) */}
        {grant.summary && (
          <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-3">{grant.summary}</p>
        )}

        {/* Smart Tags Display */}
        {grant.tags && grant.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
                {grant.tags.map((tag, idx) => (
                    <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-600 border border-slate-200">
                        {tag}
                    </span>
                ))}
            </div>
        )}

        {/* Dates */}
        <div className="bg-slate-50 rounded-lg p-3 mb-4 border border-slate-100">
          <div className="flex items-start gap-2 text-sm text-slate-600 mb-1">
            <Clock size={16} className="text-blue-600 mt-0.5" />
            <div>
              <span className="text-xs text-slate-400 block">신청기간</span>
              <span className="font-semibold text-slate-800">
                {grant.startDate && grant.endDate
                  ? `${grant.startDate} ~ ${grant.endDate}`
                  : grant.periodText || grant.startDate || grant.endDate || '상시접수 (공고문 참조)'}
              </span>
            </div>
          </div>
          {grant.supportAmount && (
            <div className="mt-2 pt-2 border-t border-slate-200 text-xs text-slate-500">
               지원규모: <span className="font-medium text-slate-700">{grant.supportAmount}</span>
            </div>
          )}
        </div>
      </div>

      {/* Footer Action: 공고 원문 바로가기 */}
      <div className="p-4 border-t border-slate-100 bg-white">
        <a
          href={grant.detailUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-2 w-full h-11 rounded-lg bg-blue-900 text-white text-sm font-bold hover:bg-blue-800 transition-colors shadow-sm"
        >
          공고 원문 보기 <ExternalLink size={15} />
        </a>
      </div>
    </div>
  );
};
