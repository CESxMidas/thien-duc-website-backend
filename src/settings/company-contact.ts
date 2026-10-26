export type CompanyContact = {
  phone: string;
  email: string;
  taxCode: string;
  address: { vi: string; en?: string };
};

// Giữ thông tin đã được xác nhận trên website khi chưa có bản cài đặt trong DB.
export const DEFAULT_COMPANY_CONTACT: CompanyContact = {
  phone: '0909 768 001',
  email: 'dautuxaydungthienduc@yahoo.com',
  taxCode: '0309910290',
  address: {
    vi: 'Số 10 Trần Não, KP5, P. Bình Trưng, TP. Hồ Chí Minh, Việt Nam',
    en: 'No. 10 Tran Nao Street, Quarter 5, Binh Trung Ward, Ho Chi Minh City, Vietnam',
  },
};
