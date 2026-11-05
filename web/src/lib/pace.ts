/**
 * Vung toc do noi (tu / phut) ma may cham PTE thuong cho Oral Fluency.
 *
 * ⚠️ CON SO NAY NAM O HAI NOI va phai khop nhau:
 *   - day (phia web: the diem tren man hinh)
 *   - api/src/prompts.ts (cau mo ta cho Gemini o man Record & Roast)
 * Doi mot ben thi con so tren the va cau nhan xet cua Gemini noi nguoc nhau.
 * Da ghi thanh bay trong CONTEXT_SYNC khoi 04/09.
 *
 * File nay sinh ra de phia web chi con MOT ban sao thay vi hai. KHONG chep lai
 * hai hang so nay vao island moi — import tu day.
 *
 * ⚠️ Vung 140-180 lay tu chuan Oral Fluency cua PTE va dang dung cho man
 * Record & Roast (noi tu do). Read Aloud la DOC TO, co the co nhip khac —
 * chua co du lieu that de tach vung rieng, nen dung tam vung nay va noi ro
 * tren man hinh la no muon tu Record & Roast.
 */
export const GOOD_LOW = 140;
export const GOOD_HIGH = 180;
