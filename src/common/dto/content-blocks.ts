/**
 * Tran SO LUONG doan cho cac field `content[]` (tin tuc, trang tinh).
 *
 * Vi sao can: `@MaxLength` chi chan DO DAI tung doan, khong chan SO doan. Da do
 * duoc o AUDIT-M1 (defect D6): `POST /news` voi `content` gom **5.000 doan**
 * tra 201, vi moi doan chi vai byte nen tong payload van duoi tran body 2 MB.
 *
 * Con so 500 lay tu du lieu THAT, khong doan:
 * - 18 bai nhap tu website hien huu cua cong ty
 *   (`prisma/news-thienduccons-import.json`): min 2 doan, trung vi 17, p90 41,
 *   **cao nhat 48 doan**.
 * - 500 la ~10x bai dai nhat that -> khong the chan nham noi dung chinh dang.
 * - Admin CMS tach doan theo DONG TRONG, nen so doan xap xi so doan van ma bien
 *   tap vien go; 500 doan la mot bai dai bat thuong.
 *
 * Quan he voi cac tran khac (van tuong thich):
 * - Tran tong payload van la body parser **2 MB** (`common/body-limit.ts`) - do
 *   moi la rang buoc rang buoc tong kich thuoc. 500 x 100.000 ky tu > 2 MB rat
 *   nhieu, nen bai dai thuc su se cham tran body TRUOC khi cham tran nay.
 * - Tran nay chan dung lop con lai: mang RAT NHIEU doan RAT NHO - loai payload
 *   ma tran body khong bat duoc.
 */
export const MAX_CONTENT_BLOCKS = 500;
