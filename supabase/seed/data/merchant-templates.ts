export interface MerchantTemplate {
  name: string;
  description: string;
  category: string;
  website?: string;
}

export const MERCHANT_TEMPLATES: Record<string, MerchantTemplate[]> = {
  'Refill Station': [
    { name: 'Isi Ulang Kemang', description: 'Stasiun refill sabun, deterjen, dan produk rumah tangga ramah lingkungan.', category: 'Refill Station' },
    { name: 'EcoRefill Bali', description: 'Refill station terlengkap di Bali — dari shampoo bar sampai minyak goreng.', category: 'Refill Station' },
    { name: 'Zero Waste Hub', description: 'One-stop shop untuk refill semua kebutuhan rumah tangga tanpa plastik.', category: 'Refill Station' },
    { name: 'Refill Corner Bandung', description: 'Pojok refill di jantung kota Bandung — bawa wadahmu, isi ulang di sini!', category: 'Refill Station' },
    { name: 'Green Refill Station', description: 'Komunitas refill terbesar di Surabaya. Harga terjangkau, ramah bumi.', category: 'Refill Station' },
  ],
  'Vegan': [
    { name: 'Warung Sayur Hijau', description: 'Masakan Sunda vegan autentik dari bahan lokal organik.', category: 'Vegan' },
    { name: 'Green Kitchen Ubud', description: 'Plant-based cafe dengan view sawah. Smoothie bowls & nasi campur vegan.', category: 'Vegan' },
    { name: 'Daun Cafe', description: 'Casual dining plant-based di Menteng. Menu Indonesia 100% vegan.', category: 'Vegan' },
    { name: 'Sayuran Segar', description: 'Vegan street food ala Indonesia — pecel, gado-gado, ketoprak, semuanya!', category: 'Vegan' },
    { name: 'Bumi Resto', description: 'Fine dining vegetarian & vegan dengan sentuhan molecular gastronomy.', category: 'Vegan' },
  ],
  'Thrift Store': [
    { name: 'Preloved Jakarta', description: 'Curated second-hand fashion dari brand lokal & internasional.', category: 'Thrift Store' },
    { name: 'Second Chance Bali', description: 'Thrift shop unik di Seminyak — vintage clothing & accessories.', category: 'Thrift Store' },
    { name: 'Vintage Dago', description: 'Toko pakaian bekas berkualitas di Dago, Bandung. Murah, gaya, dan berkelanjutan.', category: 'Thrift Store' },
    { name: 'Re:Wear Surabaya', description: 'Fashion berkelanjutan untuk anak muda Surabaya. Trade-in & buy preloved.', category: 'Thrift Store' },
  ],
  'Repair Shop': [
    { name: 'Fix It Studio', description: 'Reparasi elektronik, sepatu, tas — jangan buang, perbaiki!', category: 'Repair Shop' },
    { name: 'EcoRepair Menteng', description: 'Bengkel repair premium — HP, laptop, gadget dengan garansi.', category: 'Repair Shop' },
    { name: 'Bengkel Ramah', description: 'Repair shop komunitas di Bandung. Harga jujur, kerja rapih.', category: 'Repair Shop' },
    { name: 'Tukang Sol Profesional', description: 'Spesialis repair sepatu & tas kulit. 20 tahun pengalaman.', category: 'Repair Shop' },
  ],
  'Eco Products': [
    { name: 'Bamboo Corner', description: 'Produk bambu handmade — dari sikat gigi sampai furniture.', category: 'Eco Products' },
    { name: 'Toko Hijau', description: 'Supermarket mini ramah lingkungan. Semua produk eco-certified.', category: 'Eco Products' },
    { name: 'Sustainable Store', description: 'Peralatan rumah tangga biodegradable & reusable. Say no to plastic!', category: 'Eco Products' },
    { name: 'Bumi Goods', description: 'Curated eco-products dari brand lokal Indonesia. Packaging zero waste.', category: 'Eco Products' },
  ],
  'Café': [
    { name: 'Kopi Bumi', description: 'Single-origin coffee dari petani lokal. Seduh manual, rasa autentik.', category: 'Café' },
    { name: 'Earth Brew', description: 'Specialty coffee shop yang menggunakan 100% energi surya.', category: 'Café' },
    { name: 'Kedai Alam', description: 'Ngopi santai di taman hijau. WiFi kencang, air gratis, no plastic cups.', category: 'Café' },
    { name: 'Roast & Root', description: 'Coffee & plant shop in one. Beli kopi, bawa pulang tanaman.', category: 'Café' },
  ],
  'Market': [
    { name: 'Pasar Organik Senayan', description: 'Pasar tani mingguan — sayur organik langsung dari petani.', category: 'Market' },
    { name: 'Ubud Farmers Market', description: 'Weekly organic market di Ubud. Fresh produce, homemade goods.', category: 'Market' },
  ],
  'Books': [
    { name: 'Baca Ulang', description: 'Toko buku bekas terkurasi. Beli, baca, tukar lagi. Literasi berkelanjutan.', category: 'Books' },
    { name: 'EcoReads', description: 'Perpustakaan mini & toko buku preloved. Borrow or buy, your choice.', category: 'Books' },
  ],
};

/** Flatten all templates into one array */
export const ALL_MERCHANT_TEMPLATES: MerchantTemplate[] = Object.values(MERCHANT_TEMPLATES).flat();

/**
 * Map from category → reward templates.
 * Each entry has title, description, points_required, discount info.
 */
export interface RewardTemplate {
  title: string;
  description: string;
  terms: string;
  points: number;
  discountPct?: number;
  discountAmount?: number;
}

export const REWARD_TEMPLATES: Record<string, RewardTemplate[]> = {
  'Refill Station': [
    { title: 'Isi Ulang Gratis 500ml', description: 'Free refill sabun cuci piring 500ml.', terms: 'Berlaku 1x per user. Bawa wadah sendiri.', points: 50 },
    { title: 'Diskon 20% Semua Refill', description: 'Potongan 20% untuk semua produk refill.', terms: 'Min. purchase Rp20.000.', points: 30, discountPct: 20 },
  ],
  'Vegan': [
    { title: 'Free Jus Sayur', description: 'Gratis 1 cold-pressed juice pilihan.', terms: 'Berlaku untuk dine-in.', points: 40 },
    { title: 'Diskon 15% Menu Utama', description: 'Diskon 15% semua menu utama vegan.', terms: 'Tidak berlaku promo lain.', points: 60, discountPct: 15 },
    { title: 'Free Nasi Kuning Vegan', description: 'Gratis 1 porsi nasi kuning vegan komplit.', terms: 'Berlaku Senin-Jumat.', points: 150 },
  ],
  'Thrift Store': [
    { title: 'Beli 2 Gratis 1', description: 'Beli 2 item, gratis 1 item termurah.', terms: 'Berlaku untuk semua item.', points: 100 },
    { title: 'Voucher Rp25.000', description: 'Voucher belanja Rp25.000.', terms: 'Min. purchase Rp75.000.', points: 80, discountAmount: 25000 },
  ],
  'Repair Shop': [
    { title: 'Diagnostic Gratis', description: 'Free cek & diagnosa kerusakan gadget.', terms: 'Berlaku 1x per device.', points: 30 },
    { title: 'Diskon 20% Reparasi HP', description: 'Potongan 20% untuk perbaikan HP.', terms: 'Tidak termasuk spare part original.', points: 200, discountPct: 20 },
  ],
  'Eco Products': [
    { title: 'Gratis Tote Bag Eco', description: 'Free tote bag dari bahan daur ulang.', terms: 'Min. purchase Rp50.000.', points: 75 },
    { title: 'Diskon 10% Produk Bambu', description: 'Potongan harga 10% untuk semua produk bambu.', terms: 'Tidak berlaku double diskon.', points: 40, discountPct: 10 },
  ],
  'Café': [
    { title: 'Free Kopi Susu', description: 'Gratis 1 es kopi susu.', terms: 'Berlaku untuk ukuran regular.', points: 45 },
    { title: 'Free Pastry dengan Kopi', description: 'Gratis 1 pastry dengan pembelian kopi apa saja.', terms: 'Dine-in only.', points: 80 },
  ],
  'Market': [
    { title: 'Diskon 15% Sayur Organik', description: 'Potongan 15% untuk semua sayur organik.', terms: 'Berlaku hari Sabtu & Minggu.', points: 35, discountPct: 15 },
  ],
  'Books': [
    { title: 'Buku Gratis (Preloved)', description: 'Pilih 1 buku preloved gratis.', terms: 'Berlaku untuk buku < Rp50.000.', points: 60 },
  ],
};
