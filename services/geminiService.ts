import { GoogleGenAI } from "@google/genai";
import { Grant } from "../types";

// In a real scenario, this would be safely stored.
// For the purpose of this demo, we assume process.env.API_KEY is available.
const apiKey = process.env.API_KEY || '';

const ai = new GoogleGenAI({ apiKey });

export const GeminiService = {
  async analyzeSuitability(grant: Grant, industry: string): Promise<string> {
    if (!apiKey) {
      return "AI 분석 기능을 사용하려면 API 키가 필요합니다.";
    }

    try {
      const model = 'gemini-3-flash-preview';
      const prompt = `
        당신은 대한민국 최고의 정부지원금 전문 컨설턴트입니다.
        
        [기업 정보]
        - 업종: ${industry}
        
        [지원사업 정보]
        - 공고명: ${grant.title}
        - 소관부처: ${grant.department}
        - 수행기관: ${grant.agency}
        - 지원분야: ${grant.category}
        - 신청기간: ${grant.startDate} ~ ${grant.endDate}
        
        위 기업이 이 지원사업에 선정될 가능성과 그 이유를 3줄 이내로 매우 간략하게 분석해주세요. 
        특히 소관부처와 신청기간을 고려하여 시급성이나 지역 적합성을 언급하면 좋습니다.
        말투는 "사장님, 이 사업은 ~한 이유로 추천드립니다." 처럼 정중하고 전문적인 톤을 사용하세요.
      `;

      const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
      });

      return response.text || "분석 결과를 불러올 수 없습니다.";
    } catch (error) {
      console.error("Gemini analysis failed", error);
      return "현재 AI 분석 서비스 연결이 원활하지 않습니다. 잠시 후 다시 시도해주세요.";
    }
  }
};