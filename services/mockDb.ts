import { GeneralInquiry, UserSession } from '../types';
import { CsvService } from './csvService';

// Simulated delay helper
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Replace this URL with your deployed Google Apps Script Web App URL
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec'; 

export const MockDbService = {
  // Check if the user is a VIP client (Gatekeeping via CSV Data)
  async verifyClient(inputBrn: string): Promise<UserSession | null> {
    await delay(600); // Simulate processing
    
    // Load fresh data from CSV
    const clientDb = await CsvService.getClientData();
    
    // Normalize input: remove hyphens and spaces
    const normalizedInput = inputBrn.replace(/[^0-9]/g, '');

    // Search in the DB
    const matchedClient = clientDb.find(client => {
      const normalizedDbBrn = client.biz_number.replace(/[^0-9]/g, '');
      return normalizedDbBrn === normalizedInput;
    });

    if (matchedClient) {
      // Smart Auto-Mapping for Filters
      const region = CsvService.mapRegion(matchedClient.address);
      const industry = CsvService.mapIndustry(matchedClient.biz_category);

      return {
        type: 'CLIENT',
        identifier: matchedClient.biz_number,
        companyName: matchedClient.company_name,
        ceoName: matchedClient.ceo_name,
        industry: industry, // Auto-mapped industry
        region: region      // Auto-mapped region
      };
    }
    
    return null;
  },

  // Save general inquiry to Google Sheets
  async submitInquiry(data: GeneralInquiry): Promise<boolean> {
    await delay(1000);
    
    console.log('[Service] Submitting to Google Sheet:', data);

    try {
      // NOTE: In a real deployment, you would use a Google Apps Script Web App 
      // acting as a proxy to avoid CORS issues or handle the POST request.
      // Below is an example of how the fetch would look.
      
      /* 
      const response = await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8', // Google Apps Script requires this content type to avoid CORS preflight sometimes
        },
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error('Network response was not ok');
      */

      // For this demo, we assume success
      return true;
    } catch (error) {
      console.error('Google Sheet Submission Error:', error);
      return false;
    }
  }
};