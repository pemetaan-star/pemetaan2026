// ==========================================
// 1. KONFIGURASI APLIKASI
// ==========================================
function getAppConfig() {
  const props = PropertiesService.getScriptProperties();
  const assetUid = props.getProperty('ASSET_UID') || '';
  return {
    token: props.getProperty('KOBO_TOKEN'),
    assetUid: assetUid,
    baseUrl: props.getProperty('KOBO_BASE_URL') || 'https://kf.kobotoolbox.org/api/v2/assets/',
    kcBaseUrl: props.getProperty('KOBO_KC_BASE_URL') || 'https://kc.kobotoolbox.org',
    formId: props.getProperty('KOBO_FORM_ID') || '',
    formhubUuid: props.getProperty('KOBO_FORMHUB_UUID') || '',
    spreadsheetId: props.getProperty('SPREADSHEET_ID') || '',
    sheetName: props.getProperty('SHEET_NAME') || 'KOBO_FORM',
    userSheetName: props.getProperty('USER_SHEET_NAME') || 'User',
    koboFormUrl: props.getProperty('KOBO_FORM_URL') || '',
    folderUtamaId: props.getProperty('FOLDER_UTAMA') || '',
    submissionUrl: props.getProperty('KOBO_SUBMISSION_URL') || ''
  };
}

function getKoboSubmissionEndpoint(config) {
  if (!config.token || !config.assetUid) {
    return { success: false, message: 'Konfigurasi asset atau token Kobo belum lengkap.' };
  }

  // API v2 tidak selalu mengembalikan deployment__submission_url. Endpoint
  // pengiriman OpenRosa adalah /submission pada server KoboCollect. Jangan
  // gunakan deployment__identifier sebagai form_id karena nilainya bukan
  // jaminan identifier yang tertulis di XForm.
  const assetUrl = `${config.baseUrl.replace(/\/+$/, '')}/${config.assetUid}/`;
  try {
    const response = UrlFetchApp.fetch(assetUrl, {
      method: 'get',
      headers: { Authorization: 'Token ' + config.token },
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      return { success: false, message: `Tidak dapat membaca konfigurasi asset Kobo (HTTP ${code}): ${response.getContentText()}` };
    }

    const asset = JSON.parse(response.getContentText());
    if (asset.deployment__active !== true) {
      return { success: false, message: 'Form Kobo belum aktif. Buka KoboToolbox lalu pilih Deploy / Redeploy.' };
    }
    const rawSettings = asset.content && asset.content.settings;
    const settings = Array.isArray(rawSettings)
      ? rawSettings[0] || {}
      : rawSettings && typeof rawSettings === 'object'
        ? rawSettings
        : {};
    // form_id pada sheet `settings` XLSForm adalah identifier yang dicari
    // server OpenRosa. Nilai ini berbeda dari asset UID maupun display name.
    // Jika kolom form_id pada settings XLSForm kosong, Kobo memakai UID asset
    // sebagai identifier form yang dideploy.
    const formId = String(settings.form_id || config.formId || asset.uid || config.assetUid || '').trim();
    if (!formId) {
      return { success: false, message: 'form_id tidak ditemukan pada metadata asset. Isi Script Property KOBO_FORM_ID dengan nilai kolom form_id pada sheet settings XLSForm.' };
    }
    const kcBaseUrl = config.kcBaseUrl.replace(/\/+$/, '');
    const ownerUsername = String(asset.owner__username || '').trim();
    const submissionUrls = [
      ownerUsername ? `${kcBaseUrl}/${encodeURIComponent(ownerUsername)}/submission` : '',
      config.submissionUrl,
      `${kcBaseUrl}/submission`
    ].map(value => String(value || '').trim());
    return { success: true, urls: [...new Set(submissionUrls.filter(Boolean))], formId: formId };
  } catch (e) {
    return { success: false, message: 'Gagal membaca konfigurasi deployment Kobo: ' + e.toString() };
  }
}

// Jalankan manual dari Apps Script saat mendiagnosis koneksi Kobo.
// Aman untuk dibagikan karena token tidak pernah dikembalikan.
function diagnoseKoboAsset() {
  const config = getAppConfig();
  const assetUrl = `${config.baseUrl.replace(/\/+$/, '')}/${config.assetUid}/`;
  const response = UrlFetchApp.fetch(assetUrl, {
    method: 'get',
    headers: { Authorization: 'Token ' + config.token },
    muteHttpExceptions: true
  });
  const result = {
    assetUrl: assetUrl,
    httpStatus: response.getResponseCode(),
    configuredFormId: config.formId || '(kosong)',
    configuredSubmissionUrl: config.submissionUrl || '(kosong)'
  };
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    result.response = response.getContentText();
    return result;
  }

  const asset = JSON.parse(response.getContentText());
  result.assetUid = asset.uid || '(tidak tersedia)';
  result.ownerUsername = asset.owner__username || '(tidak tersedia)';
  result.deploymentActive = asset.deployment__active;
  result.deploymentIdentifier = asset.deployment__identifier || '(tidak tersedia)';
  result.xlsFormSettings = asset.content && asset.content.settings ? asset.content.settings : '(tidak tersedia)';
  result.endpointsTried = getKoboSubmissionEndpoint(config).urls || [];
  return result;
}

// ==========================================
// 2. ROUTING WEB APP
// ==========================================
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Dashboard Pemetaan Hotspot Malang 2026')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ==========================================
// 3. AUTENTIKASI USER
// ==========================================
function normalizeUserValue(value) {
  // Header dan username dari spreadsheet kadang membawa BOM atau spasi
  // non-breaking saat hasil copy-paste. Normalisasi ini mencegah akun valid
  // ditolak hanya karena karakter tak terlihat tersebut.
  return String(value === undefined || value === null ? '' : value)
    .replace(/^\uFEFF/, '')
    .replace(/\u00A0/g, ' ')
    .trim()
    .toLowerCase();
}

function findUserColumn(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeUserValue);
  return headers.findIndex(header => normalizedAliases.includes(header));
}

function roleCanEditQC(role) {
  const roleKey = normalizeUserValue(role).replace(/[^a-z0-9]/g, '');
  return roleKey.includes('dataanalis') ||
    roleKey.includes('dataanalyst') ||
    roleKey.includes('koordinator') ||
    roleKey.includes('kordinator');
}

function roleIsAdmin(role) {
  const roleKey = normalizeUserValue(role).replace(/[^a-z0-9]/g, '');
  return roleKey === 'admin' || roleKey === 'administrator' || roleKey === 'adminstrator';
}

function roleIsEnumerator(role) {
  return normalizeUserValue(role) === 'enumerator';
}

function roleIsSupervisor(role) {
  const roleKey = normalizeUserValue(role).replace(/[^a-z0-9]/g, '');
  return roleKey.includes('supervisor') || roleKey.includes('koordinator') || roleKey.includes('kordinator');
}

function sameEnumerator(valueFromData, loggedInName) {
  const dataValue = normalizeUserValue(valueFromData);
  const userValue = normalizeUserValue(loggedInName);
  if (!dataValue || !userValue) return false;
  const dataKey = dataValue.replace(/[^a-z0-9]/g, '');
  const userKey = userValue.replace(/[^a-z0-9]/g, '');
  const aliases = { automatic: 'anggaachmadp' };
  return dataValue === userValue || dataKey === userKey || aliases[dataKey] === userKey || aliases[userKey] === dataKey;
}

function getEnumeratorFormValue(name) {
  const key = normalizeUserValue(name).replace(/[^a-z0-9]/g, '');
  const values = {
    anggaachmadp: 'angga_achmad_p',
    azkarizkynugraha: 'azka_rizky_nugraha',
    baguswahyudi: 'bagus_wahyudi',
    fandyindram: 'fandy_indra_m',
    ginanjarmulya: 'ginanjar_mulya_a',
    maharanisyahrizadewi: 'maharani_syahriza_dewi',
    muhammadgufron: 'muhammad_gufron',
    muhammadrizky: 'muhammad_rizky',
    nikeikawahyuni: 'nike_ika_wahyuni',
    nurfitria: 'nur_fitri_a',
    rikepurnawatifebrianti: 'rike_purnawati_febrianti',
    roniabdinugroho: 'roni_abdi_nugroho'
  };
  return values[key] || name;
}

function getEnumeratorLabel(value) {
  const key = normalizeUserValue(value).replace(/[^a-z0-9]/g, '');
  const labels = {
    automatic: 'ANGGA ACHMAD P',
    anggaachmadp: 'ANGGA ACHMAD P',
    azkarizkynugraha: 'AZKA RIZKY NUGRAHA',
    baguswahyudi: 'BAGUS WAHYUDI',
    fandyindram: 'FANDY INDRA M',
    ginanjarmulyaa: 'GINANJAR MULYA A',
    maharanisyahrizadewi: 'MAHARANI SYAHRIZA DEWI',
    muhammadgufron: 'MUHAMMAD GUFRON',
    muhammadrizky: 'MUHAMMAD RIZKY',
    nikeikawahyuni: 'NIKE IKA WAHYUNI',
    nurfitria: 'NUR FITRI A',
    rikepurnawatifebrianti: 'RIKE PURNAWATI FEBRIANTI',
    roniabdinugroho: 'RONI ABDI NUGROHO'
  };
  return labels[key] || value;
}

function getOrCreateFolder(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);
  return folders.hasNext() ? folders.next() : parentFolder.createFolder(folderName);
}

function xmlEscape(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function downloadKoboAttachments(row, config) {
  if (!config.folderUtamaId || !row || !row._attachments) return {};

  let attachments = row._attachments;
  if (typeof attachments === 'string') {
    try { attachments = JSON.parse(attachments); } catch (e) { return {}; }
  }
  if (!Array.isArray(attachments)) return {};

  const parentFolder = DriveApp.getFolderById(config.folderUtamaId);
  const enumeratorRootFolder = getOrCreateFolder(parentFolder, 'Enumerator');
  const enumeratorName = getEnumeratorLabel(row['sec_a/nama_enumerator'] || 'Tanpa Enumerator');
  const enumeratorFolder = getOrCreateFolder(enumeratorRootFolder, enumeratorName);
  const formId = String(row['_id'] || row['meta/instanceID'] || row['_uuid'] || 'Tanpa ID Formulir')
    .replace(/^uuid:/i, '')
    .trim();
  const formFolder = getOrCreateFolder(enumeratorFolder, formId);
  const links = [];

  attachments.forEach(attachment => {
    const downloadUrl = attachment.download_url || attachment.download_large_url || attachment.url;
    if (!downloadUrl) return;

    const filename = String(attachment.filename || attachment.media_file_basename || 'attachment').split('/').pop();
    const existingFiles = formFolder.getFilesByName(filename);
    if (existingFiles.hasNext()) {
      links.push(existingFiles.next().getUrl());
      return;
    }

    const response = UrlFetchApp.fetch(downloadUrl, {
      method: 'get',
      headers: { Authorization: 'Token ' + config.token },
      muteHttpExceptions: true
    });
    const responseCode = response.getResponseCode();
    if (responseCode < 200 || responseCode >= 300) {
      Logger.log(`Gagal mengunduh attachment ${filename}: HTTP ${responseCode}`);
      return;
    }
    const file = formFolder.createFile(response.getBlob().setName(filename));
    links.push(file.getUrl());
  });

  return links.length ? { 'sec_b/foto_lokasi_url': links.join('\n') } : {};
}

function authenticateUser(username, password) {
  try {
    const config = getAppConfig();
    const sheet = SpreadsheetApp.openById(config.spreadsheetId).getSheetByName(config.userSheetName);
    if (!sheet) return { success: false, message: `Sheet '${config.userSheetName}' tidak ditemukan.` };

    const values = sheet.getDataRange().getDisplayValues();
    if (values.length < 2) return { success: false, message: 'Data user belum tersedia.' };

    const headers = values[0].map(normalizeUserValue);
    const displayNameColumnIndex = findUserColumn(headers, ['nama user', 'nama', 'name', 'nama lengkap', 'nama pengguna']);
    const usernameColumnIndex = findUserColumn(headers, ['username', 'user name', 'user_id', 'id user']);
    // Sheet minimal boleh hanya memiliki Username, Sandi, dan Role. Dalam
    // kasus ini username juga ditampilkan sebagai nama akun setelah masuk.
    const usernameIndex = usernameColumnIndex === -1 ? displayNameColumnIndex : usernameColumnIndex;
    const displayNameIndex = displayNameColumnIndex === -1 ? usernameIndex : displayNameColumnIndex;
    const passwordIndex = findUserColumn(headers, ['sandi', 'password', 'kata sandi', 'passwd']);
    const roleIndex = findUserColumn(headers, ['role', 'peran', 'jabatan']);
    if (usernameIndex === -1 || passwordIndex === -1 || roleIndex === -1) {
      return { success: false, message: "Header sheet User belum lengkap. Gunakan Username (atau Nama User), Sandi/Password, dan Role/Peran." };
    }

    const requestedUsername = normalizeUserValue(username);
    const requestedPassword = String(password === undefined || password === null ? '' : password);
    if (!requestedUsername || !requestedPassword) {
      return { success: false, message: 'Username dan sandi wajib diisi.' };
    }
    const matchedRow = values.slice(1).find(row => {
      const matchesUsername = normalizeUserValue(row[usernameIndex]) === requestedUsername;
      // Jika kolom Username tersedia, nama tampilan juga dapat dipakai untuk
      // masuk. Ini tetap aman karena sandi harus cocok.
      const matchesDisplayName = usernameColumnIndex !== -1 &&
        normalizeUserValue(row[displayNameIndex]) === requestedUsername;
      return (matchesUsername || matchesDisplayName) && String(row[passwordIndex]) === requestedPassword;
    });
    if (!matchedRow) return { success: false, message: 'Nama user atau sandi salah.' };

    const sessionToken = Utilities.getUuid();
    const sessionUser = {
      name: String(matchedRow[displayNameIndex]).trim(),
      role: String(matchedRow[roleIndex]).trim(),
      canEditQC: roleCanEditQC(matchedRow[roleIndex])
    };
    CacheService.getScriptCache().put(`auth:${sessionToken}`, JSON.stringify(sessionUser), 21600);
    return { success: true, token: sessionToken, user: sessionUser };
  } catch (e) {
    Logger.log('Error Login: ' + e.toString());
    return { success: false, message: 'Login gagal: ' + e.toString() };
  }
}

function requireSession(sessionToken) {
  if (!sessionToken) throw new Error('Sesi login tidak ditemukan. Silakan login kembali.');
  const session = CacheService.getScriptCache().get(`auth:${sessionToken}`);
  if (!session) throw new Error('Sesi login sudah berakhir. Silakan login kembali.');
  return JSON.parse(session);
}

function logoutUser(sessionToken) {
  if (sessionToken) CacheService.getScriptCache().remove(`auth:${sessionToken}`);
  return { success: true };
}

function getEnumeratorFormUrl(sessionToken) {
  const sessionUser = requireSession(sessionToken);
  if (!roleIsEnumerator(sessionUser.role)) {
    return { success: false, message: 'Menu input form hanya tersedia untuk Enumerator.' };
  }
  const config = getAppConfig();
  if (!config.koboFormUrl) {
    return { success: false, message: 'KOBO_FORM_URL belum diatur pada Script Properties.' };
  }
  return { success: true, url: config.koboFormUrl };
}

function saveSupervision(sessionToken, supervisionData) {
  const sessionUser = requireSession(sessionToken);
  if (!roleIsSupervisor(sessionUser.role)) {
    return { success: false, message: 'Form supervisi hanya tersedia untuk Supervisor atau Koordinator.' };
  }

  if (!supervisionData) return { success: false, message: 'Data supervisi wajib diisi.' };
  const supervisionId = String(supervisionData.supervisionId || '').trim() || `SUP-${Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT+7', 'yyyyMMdd-HHmmss')}-${Utilities.getUuid().slice(0, 8)}`;

  const statusFinal = String(supervisionData.statusFinal || supervisionData.status_final || '').trim() ||
    (String(supervisionData.kesimpulanSupervisi || supervisionData.kesimpulan_supervisi || '').includes('diperlukan_tindak_lanjut_khusus') ? 'perlu_tindak_lanjut' : 'valid');

  const allowedStatus = ['valid', 'perlu_tindak_lanjut', 'tidak_valid'];
  if (statusFinal && !allowedStatus.includes(statusFinal)) {
    return { success: false, message: 'Nilai status akhir supervisi tidak valid.' };
  }

  const tanggalSupervisi = String(supervisionData.tanggalSupervisi || supervisionData.tanggal_supervisi || '').trim();
  const lokasiWilayah = String(supervisionData.lokasiWilayah || supervisionData.lokasi_wilayah || '').trim();
  const namaSupervisor = String(supervisionData.namaSupervisor || supervisionData.nama_supervisor || sessionUser.name || '').trim();
  const namaEnumerator = String(supervisionData.namaEnumerator || supervisionData.nama_enumerator || '').trim();
  const komunitasOrganisasi = String(supervisionData.komunitasOrganisasi || supervisionData.komunitas_organisasi || '').trim();
  const jumlahHotspot = String(supervisionData.jumlahHotspot || supervisionData.jumlah_hotspot || '0').trim();

  const pelaksanaan = [1, 2, 3, 4, 5, 6, 7].map(index => {
    const key = `sup_pelaksanaan_${index}`;
    const value = supervisionData[key] || supervisionData[`pelaksanaan_${index}`] || supervisionData[`pelaksanaan${index}`] || '';
    return String(value || '');
  });

  const kualitas = [1, 2, 3, 4, 5].map(index => {
    const key = `sup_kualitas_${index}`;
    const value = supervisionData[key] || supervisionData[`kualitas_${index}`] || supervisionData[`kualitas${index}`] || '';
    return String(value || '');
  });

  const kesimpulan = String(supervisionData.kesimpulanSupervisi || supervisionData.kesimpulan_supervisi || '').trim();
  const temuan = String(supervisionData.temuanSupervisi || supervisionData.temuan_supervisi || '').trim();
  const kendala = String(supervisionData.kendalaLapangan || supervisionData.kendala_lapangan || '').trim();
  const perbaikan = String(supervisionData.perbaikanYangDibutuhkan || supervisionData.perbaikan_yang_dibutuhkan || '').trim();
  const tindakLanjut = String(supervisionData.tindakLanjut || supervisionData.tindak_lanjut || '').trim();
  const pengesahanNamaEnumerator = String(supervisionData.pengesahanNamaEnumerator || supervisionData.pengesahan_nama_enumerator || namaEnumerator || '').trim();
  const pengesahanNamaSupervisor = String(supervisionData.pengesahanNamaSupervisor || supervisionData.pengesahan_nama_supervisor || namaSupervisor || '').trim();
  const pengesahanTanggalEnumerator = String(supervisionData.pengesahanTanggalEnumerator || supervisionData.pengesahan_tanggal_enumerator || '').trim();
  const pengesahanTanggalSupervisor = String(supervisionData.pengesahanTanggalSupervisor || supervisionData.pengesahan_tanggal_supervisor || '').trim();
  const pengesahanTandaTanganEnumerator = String(supervisionData.pengesahanTandaTanganEnumerator || supervisionData.pengesahan_tanda_tangan_enumerator || '').trim();
  const pengesahanTandaTanganSupervisor = String(supervisionData.pengesahanTandaTanganSupervisor || supervisionData.pengesahan_tanda_tangan_supervisor || '').trim();
  if (!tanggalSupervisi || !lokasiWilayah || !namaSupervisor) {
    return { success: false, message: 'Tanggal supervisi, lokasi, dan nama supervisor wajib diisi.' };
  }

  const config = getAppConfig();
  const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  const sheetName = 'Supervisi';
  let sheet = spreadsheet.getSheets().find(candidate => normalizeUserValue(candidate.getName()) === normalizeUserValue(sheetName));
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  if (sheet.getName() !== sheetName) sheet.setName(sheetName);

  const supervisionHeaders = [
    'supervision_id', 'tanggal_supervisi', 'lokasi_wilayah', 'nama_supervisor', 'nama_enumerator', 'komunitas_organisasi', 'jumlah_hotspot_dipantau',
    'pelaksanaan_1', 'pelaksanaan_2', 'pelaksanaan_3', 'pelaksanaan_4', 'pelaksanaan_5', 'pelaksanaan_6', 'pelaksanaan_7',
    'kualitas_1', 'kualitas_2', 'kualitas_3', 'kualitas_4', 'kualitas_5',
    'temuan_supervisi', 'kendala_lapangan', 'perbaikan_dibutuhkan', 'tindak_lanjut',
    'kesimpulan_supervisi', 'pengesahan_nama_enumerator', 'pengesahan_nama_supervisor', 'pengesahan_tanggal_enumerator', 'pengesahan_tanggal_supervisor', 'pengesahan_tanda_tangan_enumerator', 'pengesahan_tanda_tangan_supervisor',
    'status_final'
  ];
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, supervisionHeaders.length).setValues([supervisionHeaders]);
  } else {
    const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(value => String(value).trim());
    const missingHeaders = supervisionHeaders.filter(header => !existingHeaders.includes(header));
    if (missingHeaders.length) sheet.getRange(1, existingHeaders.length + 1, 1, missingHeaders.length).setValues([missingHeaders]);
  }

  const supervisionValues = {
    supervision_id: supervisionId,
    tanggal_supervisi: tanggalSupervisi,
    lokasi_wilayah: lokasiWilayah,
    nama_supervisor: namaSupervisor,
    nama_enumerator: namaEnumerator,
    komunitas_organisasi: komunitasOrganisasi,
    jumlah_hotspot_dipantau: jumlahHotspot,
    pelaksanaan_1: pelaksanaan[0], pelaksanaan_2: pelaksanaan[1], pelaksanaan_3: pelaksanaan[2], pelaksanaan_4: pelaksanaan[3], pelaksanaan_5: pelaksanaan[4], pelaksanaan_6: pelaksanaan[5], pelaksanaan_7: pelaksanaan[6],
    kualitas_1: kualitas[0], kualitas_2: kualitas[1], kualitas_3: kualitas[2], kualitas_4: kualitas[3], kualitas_5: kualitas[4],
    temuan_supervisi: temuan, kendala_lapangan: kendala, perbaikan_dibutuhkan: perbaikan, tindak_lanjut: tindakLanjut,
    kesimpulan_supervisi: kesimpulan,
    pengesahan_nama_enumerator: pengesahanNamaEnumerator,
    pengesahan_nama_supervisor: pengesahanNamaSupervisor,
    pengesahan_tanggal_enumerator: pengesahanTanggalEnumerator,
    pengesahan_tanggal_supervisor: pengesahanTanggalSupervisor,
    pengesahan_tanda_tangan_enumerator: pengesahanTandaTanganEnumerator,
    pengesahan_tanda_tangan_supervisor: pengesahanTandaTanganSupervisor,
    status_final: statusFinal,
  };
  const finalHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(value => String(value).trim());
  sheet.appendRow(finalHeaders.map(header => supervisionValues[header] === undefined ? '' : supervisionValues[header]));
  return { success: true, message: 'Form supervisi berhasil disimpan.' };
}

function getSupervisionQueue(sessionToken) {
  const sessionUser = requireSession(sessionToken);
  if (!roleIsSupervisor(sessionUser.role)) {
    return { success: false, message: 'Antrean supervisi hanya tersedia untuk Supervisor atau Koordinator.' };
  }
  const data = readSheetData();
  if (!Array.isArray(data)) return { success: false, message: data.error || 'Data pemetaan tidak tersedia.' };
  const queue = data.filter(row => row['_id']).map(row => ({
    id: String(row['_id']),
    namaHotspot: String(row['sec_b/nama_hotspot'] || 'Tanpa Nama'),
    enumerator: String(row['sec_a/nama_enumerator'] || '-'),
    kecamatan: String(row['sec_b/kecamatan'] || '-'),
    kelurahan: String(row['sec_b/kelurahan'] || '-'),
    qcStatus: String(row['sec_e/qc_status_final'] || 'belum_divalidasi')
  }));
  return {
    success: true,
    data: queue
  };
}

function getSupervisionWorkspace(sessionToken) {
  const sessionUser = requireSession(sessionToken);
  if (!roleIsSupervisor(sessionUser.role)) {
    return { success: false, message: 'Daftar supervisi hanya tersedia untuk Supervisor atau Koordinator.' };
  }

  const queueResult = getSupervisionQueue(sessionToken);
  if (!queueResult.success) return queueResult;
  const spreadsheet = SpreadsheetApp.openById(getAppConfig().spreadsheetId);
  const supervisionSheet = spreadsheet.getSheets().find(sheet => normalizeUserValue(sheet.getName()) === 'supervisi');
  const history = [];
  const enumeratorMap = {};

  queueResult.data.forEach(row => {
    const enumerator = getEnumeratorLabel(row.enumerator || '-');
    const key = normalizeUserValue(enumerator);
    if (!enumeratorMap[key]) enumeratorMap[key] = { enumerator: enumerator, jumlahHotspot: 0, wilayahSet: {} };
    enumeratorMap[key].jumlahHotspot++;
    const wilayah = `${row.kecamatan} / ${row.kelurahan}`;
    enumeratorMap[key].wilayahSet[wilayah] = true;
  });

  if (supervisionSheet && supervisionSheet.getLastRow() > 1) {
    const values = supervisionSheet.getDataRange().getDisplayValues();
    const headers = values[0].map(value => String(value).trim());
    const indexOf = name => headers.indexOf(name);
    values.slice(1).forEach(row => {
      const supervisionId = String(row[indexOf('supervision_id')] || row[indexOf('submission_id')] || '').trim();
      if (!supervisionId) return;
      history.push({
        supervisionId: supervisionId,
        namaEnumerator: getEnumeratorLabel(row[indexOf('nama_enumerator')] || '-'),
        namaSupervisor: String(row[indexOf('nama_supervisor')] || '-'),
        tanggalSupervisi: String(row[indexOf('tanggal_supervisi')] || '-'),
        komunitasOrganisasi: String(row[indexOf('komunitas_organisasi')] || '-'),
        jumlahHotspot: String(row[indexOf('jumlah_hotspot_dipantau')] || '0'),
        kesimpulan: String(row[indexOf('kesimpulan_supervisi')] || row[indexOf('status_final')] || '-'),
        fields: headers.reduce((result, header, headerIndex) => {
          result[header] = String(row[headerIndex] || '');
          return result;
        }, {})
      });
    });
  }

  return {
    success: true,
    enumerators: Object.keys(enumeratorMap).map(key => ({
      enumerator: enumeratorMap[key].enumerator,
      jumlahHotspot: enumeratorMap[key].jumlahHotspot,
      wilayah: Object.keys(enumeratorMap[key].wilayahSet).join(', ')
    })),
    history: history
  };
}

function generateSupervisionPdf(sessionToken, supervisionId) {
  const sessionUser = requireSession(sessionToken);
  if (!roleIsSupervisor(sessionUser.role)) {
    return { success: false, message: 'PDF supervisi hanya tersedia untuk Supervisor atau Koordinator.' };
  }

  const config = getAppConfig();
  if (!config.folderUtamaId) {
    return { success: false, message: 'FOLDER_UTAMA belum diatur pada Script Properties.' };
  }
  const sheet = SpreadsheetApp.openById(config.spreadsheetId).getSheets()
    .find(candidate => normalizeUserValue(candidate.getName()) === 'supervisi');
  if (!sheet || sheet.getLastRow() < 2) {
    return { success: false, message: 'Data supervisi belum tersedia.' };
  }

  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0].map(value => String(value).trim());
  const idIndex = headers.indexOf('supervision_id');
  const targetRow = values.slice(1).find(row => String(row[idIndex] || '').trim() === String(supervisionId || '').trim());
  if (!targetRow) return { success: false, message: 'Data supervisi tidak ditemukan.' };

  const fields = headers.reduce((result, header, index) => {
    result[header] = String(targetRow[index] || '').trim();
    return result;
  }, {});
  const value = key => fields[key] || '-';
  const display = value => String(value || '-').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, char => char.toUpperCase());
  const status = value('kesimpulan_supervisi');
  const checked = option => status.indexOf(option) !== -1 ? '☑' : '☐';
  const documentTitle = 'Supervisi-' + String(supervisionId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const doc = DocumentApp.create(documentTitle);

  try {
    const body = doc.getBody();
    const title = body.appendParagraph('FORM SUPERVISI LAPANGAN PEMETAAN HOTSPOT POPULASI KUNCI');
    title.setHeading(DocumentApp.ParagraphHeading.HEADING1).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    body.appendParagraph('KOTA MALANG TAHUN 2026').setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    appendSupervisionPdfHeading(body, 'A. IDENTITAS SUPERVISI');
    appendSupervisionPdfTable(body, ['Uraian', 'Isian'], [
      ['Tanggal supervisi', value('tanggal_supervisi')], ['Lokasi/wilayah supervisi', value('lokasi_wilayah')],
      ['Nama supervisor', display(value('nama_supervisor'))], ['Nama enumerator (yang disupervisi)', display(value('nama_enumerator'))],
      ['Komunitas/Organisasi', display(value('komunitas_organisasi'))], ['Jumlah hotspot yang dipantau', value('jumlah_hotspot_dipantau')]
    ]);

    appendSupervisionPdfHeading(body, 'B. PEMERIKSAAN PELAKSANAAN LAPANGAN');
    appendSupervisionPdfTable(body, ['No', 'Komponen pemeriksaan', 'Ya', 'Tidak'], supervisionPdfCheckRows([
      'Enumerator memahami tujuan dan metode pemetaan', 'Enumerator menggunakan instrumen pemetaan yang telah ditetapkan',
      'Enumerator melakukan pengumpulan data sesuai wilayah tugas', 'Enumerator melakukan pencatatan lokasi hotspot secara lengkap',
      'Titik koordinat/GPS tercatat dengan benar', 'Informasi hotspot sesuai dengan kondisi lapangan', 'Dokumentasi pendukung tersedia sesuai kebutuhan'
    ], 'pelaksanaan', fields));

    appendSupervisionPdfHeading(body, 'C. PEMERIKSAAN KUALITAS DATA');
    appendSupervisionPdfTable(body, ['No', 'Komponen pemeriksaan', 'Ya', 'Tidak'], supervisionPdfCheckRows([
      'Data identitas hotspot terisi lengkap', 'Status hotspot telah ditentukan', 'Tidak ditemukan duplikasi data hotspot',
      'Data telah melalui proses kroscek antar enumerator', 'Data sesuai dengan definisi operasional yang ditetapkan'
    ], 'kualitas', fields));

    appendSupervisionPdfHeading(body, 'D. HASIL SUPERVISI');
    appendSupervisionPdfTable(body, ['Uraian', 'Keterangan'], [
      ['Temuan supervisi', value('temuan_supervisi')], ['Kendala lapangan', value('kendala_lapangan')],
      ['Perbaikan yang dibutuhkan', value('perbaikan_dibutuhkan')], ['Tindak lanjut', value('tindak_lanjut')]
    ]);

    appendSupervisionPdfHeading(body, 'E. KESIMPULAN SUPERVISI');
    body.appendParagraph(checked('pelaksanaan_sesuai_standar_dan_dapat_dilanjutkan') + ' Pelaksanaan sesuai standar dan dapat dilanjutkan.');
    body.appendParagraph(checked('diperlukan_perbaikan_sebelum_proses_dilanjutkan') + ' Diperlukan perbaikan sebelum proses dilanjutkan.');
    body.appendParagraph(checked('diperlukan_tindak_lanjut_khusus') + ' Diperlukan tindak lanjut khusus.');

    appendSupervisionPdfHeading(body, 'F. PENGESAHAN');
    appendSupervisionPdfTable(body, ['Enumerator', 'Supervisor'], [
      ['Nama: ' + display(value('pengesahan_nama_enumerator')), 'Nama: ' + display(value('pengesahan_nama_supervisor'))],
      ['Tanggal: ' + value('pengesahan_tanggal_enumerator'), 'Tanggal: ' + value('pengesahan_tanggal_supervisor')],
      ['Tanda Tangan: ' + value('pengesahan_tanda_tangan_enumerator'), 'Tanda Tangan: ' + value('pengesahan_tanda_tangan_supervisor')]
    ]);

    doc.saveAndClose();
    const pdfFolder = getOrCreateFolder(DriveApp.getFolderById(config.folderUtamaId), 'PDF Supervisi');
    const pdfFile = pdfFolder.createFile(doc.getAs(MimeType.PDF).setName(documentTitle + '.pdf'));
    return { success: true, message: 'PDF supervisi berhasil dibuat.', url: pdfFile.getUrl() };
  } finally {
    DriveApp.getFileById(doc.getId()).setTrashed(true);
  }
}

function appendSupervisionPdfHeading(body, text) {
  body.appendParagraph(text).setHeading(DocumentApp.ParagraphHeading.HEADING2);
}

function appendSupervisionPdfTable(body, headers, rows) {
  const table = body.appendTable([headers].concat(rows));
  for (let column = 0; column < headers.length; column++) {
    table.getCell(0, column).editAsText().setBold(true);
  }
  return table;
}

function supervisionPdfCheckRows(labels, prefix, fields) {
  return labels.map((label, index) => {
    const answer = String(fields[`${prefix}_${index + 1}`] || '').toLowerCase();
    return [String(index + 1), label, answer === 'ya' ? '☑' : '☐', answer === 'tidak' ? '☑' : '☐'];
  });
}

function submitEnumeratorForm(sessionToken, formData) {
  const sessionUser = requireSession(sessionToken);
  if (!roleIsEnumerator(sessionUser.role)) {
    return { success: false, message: 'Form input hanya tersedia untuk Enumerator.' };
  }
  if (!formData) return { success: false, message: 'Data form tidak ditemukan.' };

  const requiredFields = {
    organisasi_pelaksana: 'Organisasi pelaksana',
    nama_hotspot: 'Nama hotspot',
    kecamatan: 'Kecamatan',
    kelurahan: 'Kelurahan',
    alamat_lengkap: 'Alamat lokasi',
    titik_koordinat: 'Titik koordinat GPS',
    foto_lokasi: 'Foto lokasi',
    status_hotspot: 'Status hotspot',
    populasi_kunci: 'Populasi kunci',
    tipe_lokasi: 'Tipe lokasi',
    sub_tipe_lokasi: 'Sub-tipe lokasi',
    waktu_aktivitas: 'Waktu aktivitas',
    sumber_informasi: 'Sumber informasi',
    no_hp_informan: 'Nomor HP informan',
    keterangan_aktivitas: 'Keterangan aktivitas',
    kondisi_saat_pemetaan: 'Kondisi saat pemetaan'
  };
  for (const fieldName in requiredFields) {
    if (!formData[fieldName] || String(formData[fieldName]).trim() === '') {
      return { success: false, message: `${requiredFields[fieldName]} wajib diisi.` };
    }
  }
  if (!formData.fotoData || !formData.fotoName || !formData.fotoMime) {
    return { success: false, message: 'Foto lokasi wajib dipilih.' };
  }

  const numericValues = ['jumlah_diedukasi', 'jumlah_tes_hiv', 'jumlah_hiv_positif'];
  const numbers = {};
  for (const fieldName of numericValues) {
    numbers[fieldName] = formData[fieldName] === '' || formData[fieldName] === undefined ? 0 : Number(formData[fieldName]);
    if (!Number.isInteger(numbers[fieldName]) || numbers[fieldName] < 0) {
      return { success: false, message: 'Jumlah data HIV harus berupa bilangan bulat positif atau nol.' };
    }
  }
  if (numbers.jumlah_tes_hiv > numbers.jumlah_diedukasi || numbers.jumlah_hiv_positif > numbers.jumlah_tes_hiv) {
    return { success: false, message: 'Jumlah tes tidak boleh melebihi jumlah edukasi, dan HIV+ tidak boleh melebihi jumlah tes.' };
  }

  const config = getAppConfig();
  if (!config.token || !config.assetUid) return { success: false, message: 'Konfigurasi Kobo belum lengkap.' };

  const gpsParts = String(formData.titik_koordinat).trim().split(/[\s,]+/);
  if (gpsParts.length < 2 || isNaN(Number(gpsParts[0])) || isNaN(Number(gpsParts[1]))) {
    return { success: false, message: 'Format GPS tidak valid. Gunakan contoh: -7.9665, 112.5446.' };
  }
  const normalizedGps = `${gpsParts[0]} ${gpsParts[1]} 0 0`;

  const endpointResult = getKoboSubmissionEndpoint(config);
  if (!endpointResult.success) return endpointResult;
  if (!config.formhubUuid) {
    return { success: false, message: 'KOBO_FORMHUB_UUID belum diatur. Isi dengan nilai formhub/uuid dari XLSForm atau metadata form Kobo.' };
  }
  const submissionEndpoints = endpointResult.urls;
  const instanceId = `uuid:${Utilities.getUuid()}`;
  const submittedAt = new Date();
  const timeZone = Session.getScriptTimeZone() || 'GMT+7';
  const submittedDateTime = Utilities.formatDate(submittedAt, timeZone, "yyyy-MM-dd'T'HH:mm:ss.SSSZ");
  const submittedDate = Utilities.formatDate(submittedAt, timeZone, 'yyyy-MM-dd');
  const deviceId = `webapp:${String(sessionUser.name).replace(/\s+/g, '_').toLowerCase()}`;
  const xml = `<data id="${xmlEscape(endpointResult.formId)}" version="20260919"><start>${xmlEscape(submittedDateTime)}</start><end>${xmlEscape(submittedDateTime)}</end><today>${xmlEscape(submittedDate)}</today><deviceid>${xmlEscape(deviceId)}</deviceid><formhub><uuid>${xmlEscape(config.formhubUuid)}</uuid></formhub><sec_a><nama_enumerator>${xmlEscape(getEnumeratorFormValue(sessionUser.name))}</nama_enumerator><organisasi_pelaksana>${xmlEscape(formData.organisasi_pelaksana)}</organisasi_pelaksana></sec_a><sec_b><nama_hotspot>${xmlEscape(formData.nama_hotspot)}</nama_hotspot><kecamatan>${xmlEscape(formData.kecamatan)}</kecamatan><kelurahan>${xmlEscape(formData.kelurahan)}</kelurahan><alamat_lengkap>${xmlEscape(formData.alamat_lengkap)}</alamat_lengkap><titik_koordinat>${xmlEscape(normalizedGps)}</titik_koordinat><foto_lokasi>${xmlEscape(formData.fotoName)}</foto_lokasi></sec_b><sec_c><status_hotspot>${xmlEscape(formData.status_hotspot)}</status_hotspot><populasi_kunci>${xmlEscape(formData.populasi_kunci)}</populasi_kunci><tipe_lokasi>${xmlEscape(formData.tipe_lokasi)}</tipe_lokasi><sub_tipe_lokasi>${xmlEscape(formData.sub_tipe_lokasi)}</sub_tipe_lokasi><tipe_lokasi_lainnya>${xmlEscape(formData.tipe_lokasi_lainnya || '')}</tipe_lokasi_lainnya><waktu_aktivitas>${xmlEscape(formData.waktu_aktivitas)}</waktu_aktivitas><Estimasi_Jumlah_Populasi_Kunci>${xmlEscape(formData.estimasi_jumlah_populasi || '')}</Estimasi_Jumlah_Populasi_Kunci><jumlah_diedukasi>${numbers.jumlah_diedukasi}</jumlah_diedukasi><jumlah_tes_hiv>${numbers.jumlah_tes_hiv}</jumlah_tes_hiv><jumlah_hiv_positif>${numbers.jumlah_hiv_positif}</jumlah_hiv_positif><catatan_lapangan>${xmlEscape(formData.catatan_lapangan || '')}</catatan_lapangan></sec_c><sec_d><sumber_informasi>${xmlEscape(formData.sumber_informasi)}</sumber_informasi><no_hp_informan>${xmlEscape(formData.no_hp_informan)}</no_hp_informan><keterangan_aktivitas>${xmlEscape(formData.keterangan_aktivitas)}</keterangan_aktivitas><kondisi_saat_pemetaan>${xmlEscape(formData.kondisi_saat_pemetaan)}</kondisi_saat_pemetaan></sec_d><meta><instanceID>${instanceId}</instanceID></meta></data>`;
  const hasPhoto = formData.fotoData && formData.fotoName && formData.fotoMime;

  const buildRequestOptions = () => {
    const options = { method: 'post', headers: { Authorization: 'Token ' + config.token }, muteHttpExceptions: true };
    if (hasPhoto) {
      options.payload = {
        xml_submission_file: Utilities.newBlob(xml, 'text/xml', 'submission.xml'),
        'sec_b/foto_lokasi': Utilities.newBlob(Utilities.base64Decode(formData.fotoData), formData.fotoMime, formData.fotoName)
      };
    } else {
      options.payload = { xml_submission_file: Utilities.newBlob(xml, 'text/xml', 'submission.xml') };
    }
    return options;
  };

  const failures = [];
  for (const submissionEndpoint of submissionEndpoints) {
    try {
      const response = UrlFetchApp.fetch(submissionEndpoint, buildRequestOptions());
      const responseCode = response.getResponseCode();
      const responseBody = response.getContentText();
      if (responseCode >= 200 && responseCode < 300) {
        let responseData = {};
        try { responseData = JSON.parse(responseBody); } catch (ignored) {}
        const attachmentSaved = responseData._attachments || responseData.attachments || responseData.data && responseData.data._attachments;
        return {
          success: true,
          attachmentSaved: Boolean(attachmentSaved),
          message: attachmentSaved
            ? 'Data dan foto berhasil dikirim ke KoboToolbox.'
            : 'Data berhasil dikirim ke KoboToolbox. Periksa attachment pada submission bila foto belum terlihat.'
        };
      }
      failures.push(`HTTP ${responseCode}; endpoint: ${submissionEndpoint}; respons Kobo: ${responseBody}`);
      // Endpoint OpenRosa alternatif dapat mengembalikan 404, jadi lanjutkan.
      if (responseCode !== 404) break;
    } catch (e) {
      failures.push(`Endpoint ${submissionEndpoint}: ${e.toString()}`);
    }
  }
  return { success: false, message: `Kobo menolak data. form_id XML: ${endpointResult.formId}; percobaan endpoint:\n${failures.join('\n\n')}` };
}

// ==========================================
// 4. SINKRONISASI DATA DARI KOBO KE SPREADSHEET (Trigger 1)
// ==========================================
function syncKoboToSheet() {
  const config = getAppConfig();
  if (!config.token || !config.assetUid || !config.spreadsheetId) {
    return "Konfigurasi Kobo atau Spreadsheet belum lengkap.";
  }

  const options = { "method": "get", "headers": { "Authorization": "Token " + config.token }, "muteHttpExceptions": true };
  
  try {
    const response = UrlFetchApp.fetch(`${config.baseUrl}${config.assetUid}/data.json`, options);
    const responseCode = response.getResponseCode();
    if (responseCode < 200 || responseCode >= 300) {
      return `Gagal mengambil data Kobo (HTTP ${responseCode}): ${response.getContentText()}`;
    }
    const data = JSON.parse(response.getContentText()).results || [];
    if (data.length === 0) return "Data Kobo masih kosong.";

    const ss = SpreadsheetApp.openById(config.spreadsheetId);
    let sheet = ss.getSheetByName(config.sheetName);
    if (!sheet) sheet = ss.insertSheet(config.sheetName);

    const existingApprovalLinks = {};
    if (sheet.getLastRow() > 1) {
      const previousValues = sheet.getDataRange().getDisplayValues();
      const previousHeaders = previousValues[0].map(value => String(value).trim());
      const previousIdIndex = previousHeaders.indexOf('_id');
      const previousApprovalIndex = previousHeaders.indexOf('sec_f/dokumentasi_persetujuan_url');
      if (previousIdIndex !== -1 && previousApprovalIndex !== -1) {
        previousValues.slice(1).forEach(row => {
          const id = String(row[previousIdIndex] || '').trim();
          const link = String(row[previousApprovalIndex] || '').trim();
          if (id && link) existingApprovalLinks[id] = link;
        });
      }
    }

    data.forEach(row => {
      Object.assign(row, downloadKoboAttachments(row, config));
      delete row['sec_b/foto_lokasi'];
      const rowId = String(row['_id'] || '').trim();
      if (rowId && existingApprovalLinks[rowId] && !row['sec_f/dokumentasi_persetujuan_url']) {
        row['sec_f/dokumentasi_persetujuan_url'] = existingApprovalLinks[rowId];
      }
    });
    let headersSet = new Set();
    data.forEach(row => Object.keys(row).forEach(key => headersSet.add(key)));
    const headers = Array.from(headersSet);

    const matrix = [headers];
    data.forEach(row => {
      matrix.push(headers.map(header => {
        let val = row[header];
        if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
        return val !== undefined && val !== null ? val : "";
      }));
    });

    sheet.clearContents();
    sheet.getRange(1, 1, matrix.length, headers.length).setValues(matrix);
    const cleaningResult = syncValidDataToCleaning();
    return `Berhasil sync ${data.length} data. ${cleaningResult.message}`;
  } catch (e) {
    Logger.log("Error Sync: " + e.toString());
    return "Gagal sync Kobo: " + e.toString();
  }
}

function syncValidDataToCleaning() {
  const config = getAppConfig();
  const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  const sourceSheet = spreadsheet.getSheetByName(config.sheetName);
  if (!sourceSheet || sourceSheet.getLastRow() < 2) {
    return { success: false, message: 'Data Cleaning belum diperbarui karena sheet sumber kosong.' };
  }

  const sourceValues = sourceSheet.getDataRange().getDisplayValues();
  const sourceHeaders = sourceValues[0].map(value => String(value).trim());
  const sourceRows = sourceValues.slice(1);
  const indexOf = name => sourceHeaders.indexOf(name);
  const valueOf = (row, name) => {
    const index = indexOf(name);
    return index === -1 ? '' : String(row[index] || '').trim();
  };
  const organizationLabels = {
    lgi: 'Yayasan Lingkar Gagasan Indonesia (LGI)',
    igama: 'Yayasan IGAMA',
    wamarapa: 'Wamarapa',
    fatayat_nu: 'SSR Fatayat NU Jawa Timur (PENASUN)'
  };
  const statusLabels = {
    '1': 'Aktif', aktif: 'Aktif',
    '2': 'Baru', baru: 'Baru',
    '3': 'Tidak Aktif', tidak_aktif: 'Tidak Aktif',
    '5': 'Lama', lama: 'Lama',
    perlu_klarifikasi: 'Perlu Klarifikasi',
    valid: 'Valid', perlu_tindak_lanjut: 'Perlu Tindak Lanjut', tidak_valid: 'Tidak Valid'
  };
  const commonLabels = {
    lsl: 'LSL', transgender: 'Transgender', idu: 'IDU / PWID',
    pspl___tl__pekerja_seks_perempuan: 'PSPL / TL',
    pagi: 'Pagi', siang: 'Siang', sore: 'Sore', malam: 'Malam',
    populasi_kunci: 'Populasi Kunci', tokoh_kunci: 'Tokoh Kunci', observasi: 'Observasi', lainnya: 'Lainnya'
  };
  const humanizeCleaningValue = value => String(value || '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, character => character.toUpperCase());
  const cleanValue = (label, value) => {
    const rawValue = String(value || '').trim();
    if (!rawValue) return '';
    if (label === 'Nama Enumerator') return getEnumeratorLabel(rawValue);
    if (label === 'Organisasi Pelaksana') return organizationLabels[normalizeUserValue(rawValue)] || humanizeCleaningValue(rawValue);
    if (label === 'Status Hotspot' || label === 'Status QC') return statusLabels[normalizeUserValue(rawValue)] || humanizeCleaningValue(rawValue);
    if (label === 'Populasi Kunci' || label === 'Waktu Aktivitas') {
      return rawValue.split(/\s+/).map(item => commonLabels[normalizeUserValue(item)] || humanizeCleaningValue(item)).join(', ');
    }
    if (label === 'Tipe Lokasi' || label === 'Sub-Tipe Lokasi' || label === 'Sumber Informasi') {
      return commonLabels[normalizeUserValue(rawValue)] || humanizeCleaningValue(rawValue);
    }
    if (label === 'ID Data') return rawValue.replace(/^uuid:/i, '');
    return rawValue;
  };
  const generateHotspotCode = row => {
    const name = valueOf(row, 'sec_b/nama_hotspot');
    const kelurahan = valueOf(row, 'sec_b/kelurahan');
    const seed = normalizeUserValue(name) + '|' + normalizeUserValue(kelurahan);
    if (!seed.replace('|', '')) return '';
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
    const hex = digest.map(byte => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0')).join('').toUpperCase();
    return 'HS-' + hex.slice(0, 8);
  };
  const dateFields = ['_submission_time', 'submission_time', '_date_created', 'start', 'today'];
  const cleaningColumns = [
    ['Tanggal Pengiriman', dateFields],
    ['ID Data', ['_id', 'meta/instanceID', '_uuid']],
    ['Kode Hotspot', []],
    ['Nama Enumerator', ['sec_a/nama_enumerator']],
    ['Organisasi Pelaksana', ['sec_a/organisasi_pelaksana']],
    ['Nama Hotspot', ['sec_b/nama_hotspot']],
    ['Kecamatan', ['sec_b/kecamatan']],
    ['Kelurahan', ['sec_b/kelurahan']],
    ['Alamat Lengkap', ['sec_b/alamat_lengkap']],
    ['Titik Koordinat GPS', ['sec_b/titik_koordinat', '_geolocation']],
    ['Status Hotspot', ['sec_c/status_hotspot']],
    ['Populasi Kunci', ['sec_c/populasi_kunci']],
    ['Tipe Lokasi', ['sec_c/tipe_lokasi']],
    ['Sub-Tipe Lokasi', ['sec_c/sub_tipe_lokasi']],
    ['Waktu Aktivitas', ['sec_c/waktu_aktivitas']],
    ['Estimasi Jumlah Populasi', ['sec_c/Estimasi_Jumlah_Populasi_Kunci', 'sec_c/estimasi_jumlah_populasi']],
    ['Jumlah Diedukasi', ['sec_c/jumlah_diedukasi']],
    ['Jumlah Tes HIV', ['sec_c/jumlah_tes_hiv']],
    ['Jumlah HIV Positif', ['sec_c/jumlah_hiv_positif']],
    ['Catatan Lapangan', ['sec_c/catatan_lapangan']],
    ['Sumber Informasi', ['sec_d/sumber_informasi']],
    ['No. HP Informan', ['sec_d/no_hp_informan']],
    ['Keterangan Aktivitas', ['sec_d/keterangan_aktivitas']],
    ['Kondisi Saat Pemetaan', ['sec_d/kondisi_saat_pemetaan']],
    ['Dokumentasi Lokasi', ['sec_b/foto_lokasi_url', 'foto_lokasi_url']],
    ['Dokumen Persetujuan QC', ['sec_f/dokumentasi_persetujuan_url']],
    ['QC Kelengkapan', ['sec_e/qc_kelengkapan']],
    ['QC Kroscek Antar Enumerator', ['sec_e/qc_kroscek']],
    ['QC Duplikasi', ['sec_e/qc_duplikasi']],
    ['Status QC', ['sec_e/qc_status_final']],
    ['Catatan QC', ['sec_e/qc_catatan_analis']],
    ['Nama Pemeriksa QC', ['sec_e/qc_nama_pemeriksa']],
    ['Tanggal Pemeriksaan QC', ['sec_e/qc_tanggal_pemeriksaan']]
  ];
  const validRows = sourceRows.filter(row => normalizeUserValue(valueOf(row, 'sec_e/qc_status_final')) === 'valid');
  const dateForRow = row => {
    const value = dateFields.map(field => valueOf(row, field)).find(Boolean) || '';
    const timestamp = Date.parse(value);
    return { value: value, timestamp: Number.isNaN(timestamp) ? -Infinity : timestamp };
  };
  validRows.sort((first, second) => dateForRow(second).timestamp - dateForRow(first).timestamp);

  const cleanHeaders = cleaningColumns.map(column => column[0]);
  const cleanMatrix = [cleanHeaders].concat(validRows.map(row => cleaningColumns.map(column => {
    const value = column[0] === 'Kode Hotspot'
      ? generateHotspotCode(row)
      : column[1].map(field => valueOf(row, field)).find(Boolean) || '';
    return cleanValue(column[0], value);
  })));
  let cleaningSheet = spreadsheet.getSheetByName('Data Cleaning');
  if (!cleaningSheet) cleaningSheet = spreadsheet.insertSheet('Data Cleaning');
  cleaningSheet.clearContents();
  cleaningSheet.getRange(1, 1, cleanMatrix.length, cleanHeaders.length).setValues(cleanMatrix);
  cleaningSheet.getRange(1, 1, 1, cleanHeaders.length).setFontWeight('bold').setBackground('#d9ead3');
  cleaningSheet.setFrozenRows(1);
  if (cleanMatrix.length > 1) cleaningSheet.autoResizeColumns(1, cleanHeaders.length);
  return { success: true, message: `${validRows.length} data valid disalin ke Data Cleaning.` };
}

// ==========================================
// 5. MEMBACA DATA UNTUK DASBOR WEB APP
// ==========================================
function getSheetData(sessionToken) {
  const sessionUser = requireSession(sessionToken);
  const data = readSheetData();
  if (roleIsEnumerator(sessionUser.role) && Array.isArray(data)) {
    return data.filter(row => sameEnumerator(row['sec_a/nama_enumerator'], sessionUser.name));
  }
  return data;
}

function readSheetData() {
  try {
    const config = getAppConfig();
    const sheet = SpreadsheetApp.openById(config.spreadsheetId).getSheetByName(config.sheetName);
    if (!sheet) return { error: `Sheet '${config.sheetName}' tidak ditemukan!` };

    const displayValues = sheet.getDataRange().getDisplayValues();
    if (displayValues.length <= 1) return [];

    const headers = displayValues[0];
    const data = [];

    for (let i = 1; i < displayValues.length; i++) {
      let rowObj = {};
      for (let j = 0; j < headers.length; j++) {
        let key = headers[j].toString().trim();
        if (!key) continue;
        if (key.endsWith('__')) key = key.slice(0, -2); // Bypass error '__version__'
        const value = displayValues[i][j];
        if (rowObj[key] === undefined || rowObj[key] === '') rowObj[key] = value;
      }
      data.push(rowObj);
    }
    return data;
  } catch (e) {
    return { error: "Gagal membaca Google Sheet: " + e.toString() };
  }
}

function getRiskSummary(sessionToken) {
  const data = getSheetData(sessionToken);
  if (!Array.isArray(data)) return { success: false, message: data && data.error ? data.error : 'Data risiko tidak tersedia.' };

  const riskDays = Math.max(1, Number(PropertiesService.getScriptProperties().getProperty('RISK_DEADLINE_DAYS')) || 3);
  const now = new Date();
  const requiredFields = [
    'sec_b/nama_hotspot', 'sec_b/kecamatan', 'sec_b/kelurahan', 'sec_b/alamat_lengkap',
    'sec_b/titik_koordinat', 'sec_c/status_hotspot', 'sec_c/populasi_kunci', 'sec_c/tipe_lokasi',
    'sec_c/sub_tipe_lokasi', 'sec_c/waktu_aktivitas', 'sec_d/sumber_informasi', 'sec_d/no_hp_informan'
  ];
  const getText = (row, key) => String(row[key] === undefined || row[key] === null ? '' : row[key]).trim();
  const dateValue = row => row['_submission_time'] || row['submission_time'] || row['_date_created'] || row['today'] || '';
  const ageInDays = value => {
    const submittedAt = new Date(value);
    if (!value || Number.isNaN(submittedAt.getTime())) return null;
    return (now.getTime() - submittedAt.getTime()) / 86400000;
  };
  const riskRows = [];
  const duplicateIds = {};
  const records = data.map((row, index) => ({
    row: row,
    index: index,
    id: getText(row, '_id') || getText(row, 'meta/instanceID') || 'baris-' + (index + 2),
    name: getText(row, 'sec_b/nama_hotspot'),
    kelurahan: normalizeUserValue(getText(row, 'sec_b/kelurahan'))
  }));

  records.forEach(record => {
    const row = record.row;
    const status = normalizeUserValue(getText(row, 'sec_c/status_hotspot'));
    const missing = requiredFields.filter(field => !getText(row, field));
    const age = ageInDays(dateValue(row));
    const isNew = status === 'baru' || status === '2';
    const isInactive = status === 'tidak_aktif' || status === '3';
    const isLate = age !== null && age > riskDays;
    if (isNew || isInactive || missing.length || isLate) {
      riskRows.push({
        id: record.id,
        namaHotspot: record.name || 'Tanpa nama',
        risiko: [].concat(isNew ? ['Hotspot baru'] : [], isInactive ? ['Hotspot tidak aktif'] : [], missing.length ? ['Instrumen belum lengkap'] : [], isLate ? ['Pengiriman terlambat'] : []).join(', '),
        detail: missing.length ? 'Kolom kosong: ' + missing.join(', ') : isLate ? 'Usia data ' + Math.floor(age) + ' hari' : 'Perlu verifikasi lapangan.'
      });
    }
  });

  records.forEach((source, sourceIndex) => {
    records.slice(sourceIndex + 1).forEach(target => {
      const sameNameAndKelurahan = source.name && target.name && normalizeUserValue(source.name) === normalizeUserValue(target.name) && source.kelurahan === target.kelurahan;
      if (sameNameAndKelurahan) {
        duplicateIds[source.id] = true;
        duplicateIds[target.id] = true;
      }
    });
  });

  const duplicateSamples = records.filter(record => duplicateIds[record.id]).slice(0, 10).map(record => ({
    id: record.id,
    namaHotspot: record.name || 'Tanpa nama',
    risiko: 'Dugaan duplikasi',
    detail: 'Nama hotspot dan kelurahan sama; perlu cek silang manual.'
  }));
  const summary = {
    success: true,
    total: data.length,
    hotspotBaru: data.filter(row => ['baru', '2'].includes(normalizeUserValue(getText(row, 'sec_c/status_hotspot')))).length,
    hotspotTidakAktif: data.filter(row => ['tidak_aktif', '3'].includes(normalizeUserValue(getText(row, 'sec_c/status_hotspot')))).length,
    duplikasi: Object.keys(duplicateIds).length,
    tidakLengkap: data.filter(row => requiredFields.some(field => !getText(row, field))).length,
    terlambat: data.filter(row => { const age = ageInDays(dateValue(row)); return age !== null && age > riskDays; }).length,
    batasKeterlambatanHari: riskDays,
    items: duplicateSamples.concat(riskRows).filter((item, index, all) => all.findIndex(candidate => candidate.id === item.id && candidate.risiko === item.risiko) === index).slice(0, 30)
  };
  return summary;
}

// ==========================================
// 6. VALIDASI QC MANUAL (DARI DASBOR KE KOBO & SHEET)
// ==========================================
function saveQCValidation(sessionToken, submissionId, qcData) {
  const sessionUser = requireSession(sessionToken);
  if (!sessionUser.canEditQC) {
    return { success: false, message: 'Role Anda hanya memiliki akses lihat dashboard.' };
  }
  const validatedQcData = Object.assign({}, qcData, { namaPemeriksa: sessionUser.name });
  return saveQCValidationInternal(submissionId, validatedQcData);
}

function deleteSubmission(sessionToken, submissionId) {
  const sessionUser = requireSession(sessionToken);
  if (!roleIsAdmin(sessionUser.role)) {
    return { success: false, message: 'Hanya Admin yang dapat menghapus data.' };
  }
  const normalizedId = String(submissionId || '').trim();
  if (!normalizedId) return { success: false, message: 'ID data tidak ditemukan.' };

  const config = getAppConfig();
  if (!config.token || !config.assetUid || !config.spreadsheetId) {
    return { success: false, message: 'Konfigurasi aplikasi belum lengkap.' };
  }

  const deleteUrl = `${config.baseUrl.replace(/\/+$/, '')}/${config.assetUid}/data/${encodeURIComponent(normalizedId)}/`;
  try {
    const response = UrlFetchApp.fetch(deleteUrl, {
      method: 'delete',
      headers: { Authorization: 'Token ' + config.token },
      muteHttpExceptions: true
    });
    const responseCode = response.getResponseCode();
    if (responseCode < 200 || responseCode >= 300) {
      return { success: false, message: `Data belum dihapus dari Kobo (HTTP ${responseCode}): ${response.getContentText()}` };
    }

    const sheet = SpreadsheetApp.openById(config.spreadsheetId).getSheetByName(config.sheetName);
    if (sheet && sheet.getLastRow() > 1) {
      const values = sheet.getDataRange().getDisplayValues();
      const headers = values[0].map(value => String(value).trim());
      const idColumns = ['_id', 'meta/instanceID', '_uuid'];
      const idColumnIndexes = idColumns.map(column => headers.indexOf(column)).filter(index => index !== -1);
      for (let rowIndex = values.length - 1; rowIndex >= 1; rowIndex--) {
        if (idColumnIndexes.some(columnIndex => String(values[rowIndex][columnIndex]).replace(/^uuid:/i, '').trim() === normalizedId.replace(/^uuid:/i, ''))) {
          sheet.deleteRow(rowIndex + 1);
          break;
        }
      }
    }
    return { success: true, message: 'Data berhasil dihapus dari KoboToolbox dan Google Sheet.' };
  } catch (e) {
    Logger.log('Error hapus data: ' + e.toString());
    return { success: false, message: 'Data gagal dihapus: ' + e.toString() };
  }
}

function saveQCValidationInternal(submissionId, qcData) {
  const config = getAppConfig();
  const allowedStatus = ['valid', 'perlu_tindak_lanjut', 'tidak_valid'];
  const allowedKelengkapan = ['lengkap', 'perlu_perbaikan'];
  const allowedKroscek = ['sesuai', 'perlu_klarifikasi'];
  const allowedDuplikasi = ['tidak_ada', 'ada'];

  if (!config.token || !config.assetUid || !config.spreadsheetId) {
    return { success: false, message: "Konfigurasi aplikasi belum lengkap." };
  }
  if (!submissionId || !qcData || !qcData.namaPemeriksa || !qcData.statusFinal) {
    return { success: false, message: "ID data, keputusan final, dan nama pemeriksa wajib diisi." };
  }
  if (!allowedStatus.includes(qcData.statusFinal) ||
      !allowedKelengkapan.includes(qcData.kelengkapan) ||
      !allowedKroscek.includes(qcData.kroscek) ||
      !allowedDuplikasi.includes(qcData.duplikasi)) {
    return { success: false, message: "Nilai QC tidak valid." };
  }

  let approvalDocumentUrl = '';
  if (qcData.dokumenPersetujuanData && qcData.dokumenPersetujuanName && config.folderUtamaId) {
    const parentFolder = DriveApp.getFolderById(config.folderUtamaId);
    const approvalFolder = getOrCreateFolder(parentFolder, 'Persetujuan QC');
    const file = approvalFolder.createFile(
      Utilities.newBlob(Utilities.base64Decode(qcData.dokumenPersetujuanData), qcData.dokumenPersetujuanMime || 'application/octet-stream', qcData.dokumenPersetujuanName)
    );
    approvalDocumentUrl = file.getUrl();
  }

  const patchUrl = `${config.baseUrl}${config.assetUid}/data/bulk/`; // Harus pakai endpoint BULK
  
  const updateData = {
    "sec_e/qc_status_final": qcData.statusFinal,
    "sec_e/qc_kelengkapan": qcData.kelengkapan,
    "sec_e/qc_kroscek": qcData.kroscek,
    "sec_e/qc_duplikasi": qcData.duplikasi,
    "sec_e/qc_catatan_analis": qcData.catatanAnalis,
    "sec_e/qc_nama_pemeriksa": qcData.namaPemeriksa,
    "sec_e/qc_tanggal_pemeriksaan": Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd")
  };

  const payload = { "payload": { "submission_ids": [String(submissionId)], "data": updateData } };
  const options = { "method": "patch", "contentType": "application/json", "headers": { "Authorization": "Token " + config.token }, "payload": JSON.stringify(payload), "muteHttpExceptions": true };

  try {
    const response = UrlFetchApp.fetch(patchUrl, options);
    const code = response.getResponseCode();
    if (code === 200 || code === 201 || code === 202) {
      const sheetUpdateData = Object.assign({}, updateData);
      if (approvalDocumentUrl) sheetUpdateData['sec_f/dokumentasi_persetujuan_url'] = approvalDocumentUrl;
      updateSheetRowQC(config.spreadsheetId, config.sheetName, submissionId, sheetUpdateData);
      syncValidDataToCleaning();
      return { success: true, message: "Berhasil! Data QC telah disimpan ke KoboToolbox & Google Sheet." };
    }
    return { success: false, message: `Gagal! Server Kobo Error (${code}): ` + response.getContentText() };
  } catch (e) {
    return { success: false, message: "Sistem Error: " + e.toString() };
  }
}

function updateSheetRowQC(spreadsheetId, sheetName, submissionId, payload) {
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idColIndex = headers.indexOf('_id');
  if (idColIndex === -1) return;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idColIndex]) === String(submissionId)) {
      Object.keys(payload).forEach(key => {
        let colIdx = headers.indexOf(key);
        if (colIdx === -1) { colIdx = headers.length; headers.push(key); sheet.getRange(1, colIdx + 1).setValue(key); }
        sheet.getRange(i + 1, colIdx + 1).setValue(payload[key]);
      });
      break;
    }
  }
}

// ==========================================
// 7. SISTEM OTOMATISASI VALIDASI (AUTO-QC) (Trigger 2)
// ==========================================
function getJarakGPS(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const p1 = lat1 * Math.PI/180; const p2 = lat2 * Math.PI/180;
  const dp = (lat2-lat1) * Math.PI/180; const dl = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function runAutoQC() {
  const allData = readSheetData();
  if (!allData || allData.error) return;

  for (let i = 0; i < allData.length; i++) {
    let row = allData[i];
    let qcStatus = row['sec_e/qc_status_final'];

    // Lewati jika sudah pernah di-QC (baik oleh robot maupun manusia)
    if (qcStatus && qcStatus !== 'belum_divalidasi' && qcStatus !== '') continue;

    let isLengkap = true, isDuplikat = false, isKroscek = false;
    let catatanAuto = "[Auto-QC] ";
    
    // Cek Logika Angka
    let edukasi = parseInt(row['sec_c/jumlah_diedukasi'] || 0);
    let tesHiv = parseInt(row['sec_c/jumlah_tes_hiv'] || 0);
    let positif = parseInt(row['sec_c/jumlah_hiv_positif'] || 0);
    if (tesHiv > edukasi || positif > tesHiv) { isLengkap = false; catatanAuto += "Logika capaian HIV keliru. "; }
    if (!row['sec_b/titik_koordinat'] && !row['_geolocation']) { isLengkap = false; catatanAuto += "GPS Kosong. "; }

    // Cek duplikasi berdasarkan nama hotspot dan kelurahan.
    let myName = String(row['sec_b/nama_hotspot']).toLowerCase().trim();
    let myEnum = String(row['sec_a/nama_enumerator']).toLowerCase().trim();
    let myKelurahan = String(row['sec_b/kelurahan']).trim();

    for (let j = 0; j < allData.length; j++) {
      if (i === j) continue;
      let target = allData[j];
      let tName = String(target['sec_b/nama_hotspot']).toLowerCase().trim();
      let sameNameAndKelurahan = (myName === tName && myKelurahan === String(target['sec_b/kelurahan']).trim());

      if (sameNameAndKelurahan) {
        isDuplikat = true;
        catatanAuto += `Terindikasi duplikat dg ID ${target['_id']}. `;
        if (myEnum !== String(target['sec_a/nama_enumerator']).toLowerCase().trim()) isKroscek = true;
        break; 
      }
    }

    let finalStatus = "valid", sLengkap = "lengkap", sDup = "tidak_ada", sKros = "sesuai";
    if (!isLengkap) { finalStatus = "perlu_tindak_lanjut"; sLengkap = "perlu_perbaikan"; }
    if (isDuplikat) { finalStatus = "perlu_tindak_lanjut"; sDup = "ada"; sKros = isKroscek ? "perlu_klarifikasi" : "sesuai"; }
    if (finalStatus === "valid") catatanAuto = "Data diperiksa oleh Sistem Auto-QC. Hasil Bersih.";

    saveQCValidationInternal(row['_id'], { statusFinal: finalStatus, kelengkapan: sLengkap, kroscek: sKros, duplikasi: sDup, catatanAnalis: catatanAuto, namaPemeriksa: "Robot Auto-QC" });
  }
}
