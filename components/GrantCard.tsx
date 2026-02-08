import React, { useState } from 'react';
import { Grant, BizCategory } from '../types';
import { Button } from './Button';
import { Building2, Sparkles, ExternalLink, Clock, Heart, Tag } from 'lucide-react';
import { GeminiService } from '../services/geminiService';

interface GrantCardProps {
  grant: Grant;
  onConsult: (grant: Grant) => void;
  userIndustry?: string;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
}

export const GrantCard: React.FC<GrantCardProps> = ({ 
  grant, 
  onConsult, 
  userIndustry,
  isFavorite,
  onToggleFavorite
}) => {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAIAnalyze = async () => {
    setLoading(true);
    const result = await GeminiService.analyzeSuitability(grant, userIndustry || '일반 기업');
    setAnalysis(result);
    setLoading(false);
  };

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

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-all duration-300 hover:-translate-y-1 overflow-hidden flex flex-col h-full group relative">
      <div className="p-6 flex-1">
        {/* Top Meta */}
        <div className="flex justify-between items-start mb-3">
          <span className={`px-2.5 py-1 rounded-md text-[11px] font-bold ${getCategoryColor(grant.category)}`}>
            {grant.category}
          </span>
          
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
        
        {/* Org Info */}
        <div className="flex items-center gap-2 mb-4 text-xs text-slate-500">
           <Building2 size={14} className="text-slate-400"/>
           <span className="font-medium text-slate-700">{grant.department}</span>
           <span className="w-[1px] h-3 bg-slate-300"></span>
           <span className="truncate max-w-[120px]">{grant.agency}</span>
        </div>

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
              <span className="font-semibold text-slate-800">{grant.startDate} ~ {grant.endDate}</span>
            </div>
          </div>
          {grant.supportAmount && (
            <div className="mt-2 pt-2 border-t border-slate-200 text-xs text-slate-500">
               지원규모: <span className="font-medium text-slate-700">{grant.supportAmount}</span>
            </div>
          )}
        </div>

        {/* AI Analysis Section */}
        {analysis && (
          <div className="mb-4 p-3 bg-indigo-50 rounded-lg text-sm text-indigo-800 border border-indigo-100 animate-fadeIn relative">
            <div className="absolute -top-1.5 -left-1.5 bg-indigo-600 text-white p-0.5 rounded-full">
               <Sparkles size={12} />
            </div>
            <p className="pl-2 text-xs leading-relaxed font-medium">{analysis}</p>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-4 border-t border-slate-100 bg-white grid grid-cols-2 gap-2">
        <Button 
          variant="secondary" 
          onClick={handleAIAnalyze} 
          disabled={loading || !!analysis}
          className="text-xs h-10"
        >
          {loading ? '분석 중...' : <><Sparkles size={14} /> AI 분석</>}
        </Button>
        <div className="flex gap-1">
             <a 
                href={grant.detailUrl} 
                target="_blank" 
                rel="noreferrer"
                className="flex items-center justify-center w-10 h-10 rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
                title="공고 원문 보기"
             >
                <ExternalLink size={16} />
             </a>
            <Button 
              variant="primary" 
              onClick={() => onConsult(grant)}
              className="flex-1 text-xs h-10"
            >
              전문가 매칭
            </Button>
        </div>
      </div>
    </div>
  );
};