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
    vi: '1D Trần Não, Khu Phố 5, An Khánh, Hồ Chí Minh 71322, Việt Nam',
    en: '1D Tran Nao Street, Quarter 5, An Khanh Ward, Ho Chi Minh City 71322, Vietnam',
  },
};
