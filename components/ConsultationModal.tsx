import React, { useState } from 'react';
import { Button } from './Button';
import { Grant } from '../types';
import { X, CheckCircle } from 'lucide-react';

interface ConsultationModalProps {
  isOpen: boolean;
  onClose: () => void;
  grant: Grant | null;
}

export const ConsultationModal: React.FC<ConsultationModalProps> = ({ isOpen, onClose, grant }) => {
  const [submitted, setSubmitted] = useState(false);

  if (!isOpen || !grant) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulate sending email/notification
    setTimeout(() => {
      setSubmitted(true);
    }, 1000);
  };

  const handleClose = () => {
    setSubmitted(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl transform transition-all scale-100 overflow-hidden">
        
        {/* Header */}
        <div className="bg-blue-900 p-4 flex justify-between items-center text-white">
          <h3 className="font-bold text-lg">전문가 매칭 상담</h3>
          <button onClick={handleClose} className="hover:bg-blue-800 p-1 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          {!submitted ? (
            <>
              <div className="mb-6 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <p className="text-xs text-blue-600 font-bold mb-1">문의 대상 사업</p>
                <p className="text-sm text-blue-900 font-medium line-clamp-1">{grant.title}</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">담당자 성함</label>
                  <input type="text" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-900 focus:outline-none" placeholder="홍길동" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">연락처</label>
                  <input type="tel" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-900 focus:outline-none" placeholder="010-0000-0000" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">궁금한 점</label>
                  <textarea 
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-900 focus:outline-none h-24" 
                    defaultValue="이 사업에 우리 회사가 신청 가능한지 궁금합니다. 세무 기장 데이터 기반으로 검토 부탁드립니다."
                  ></textarea>
                </div>
                
                <div className="pt-2">
                  <Button fullWidth type="submit">상담 신청하기</Button>
                  <p className="text-xs text-center text-slate-400 mt-2">
                    대한세무법인 담당 세무사가 24시간 내 연락드립니다.
                  </p>
                </div>
              </form>
            </>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={32} className="text-green-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">신청이 완료되었습니다!</h3>
              <p className="text-slate-600 mb-6">담당자가 검토 후 등록된 연락처로<br/>빠르게 안내해 드리겠습니다.</p>
              <Button onClick={handleClose} fullWidth variant="outline">닫기</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};