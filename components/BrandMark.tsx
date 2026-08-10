import React from 'react';

// 대한세무법인 공식 로고 — 조회 결과 화면(대시보드) 왼쪽 위에만 쓴다.
//
//   원본(6000×6000, 여백 포함)은 회사 로고 PNG 원본이고, public/ 에는 여백을 잘라내고
//   웹용 크기로 줄인 파일만 넣어 두었다. 로고가 바뀌면 public/ 의 두 파일만 교체하면 된다.
//     logo-horizontal.png : 심볼 + 「대한세무법인」 가로 조합 (349×80) — 이 컴포넌트가 쓴다
//     logo-symbol.png     : 심볼 단독 (128×128) — index.html 의 탭 아이콘이 쓴다
//
//   경로에 BASE_URL 을 붙이는 이유: GitHub Pages 는 /Daehan-Tax-Corp---Smart-Policy-Fund-Matching/
//   하위로 서빙되므로 "/logo-horizontal.png" 같은 절대경로는 404 가 된다.
interface BrandMarkProps {
  className?: string;   // 높이는 여기서 지정한다 (예: 'h-8')
}

export const BrandMark: React.FC<BrandMarkProps> = ({ className = 'h-8' }) => (
  <img
    src={`${import.meta.env.BASE_URL}logo-horizontal.png`}
    alt="대한세무법인"
    width={349}
    height={80}
    className={`w-auto ${className}`}
  />
);
