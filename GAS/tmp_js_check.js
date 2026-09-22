



  let map, markersGroup, chartKec, qcModalObj, enumeratorModalObj, supervisionModalObj;
  let sessionToken = sessionStorage.getItem('dashboardSessionToken');
  let currentUser = null;
  let canEditQC = false;
  let canSupervise = false;

  document.addEventListener("DOMContentLoaded", function() {
    qcModalObj = new bootstrap.Modal(document.getElementById('modalQC'));
    enumeratorModalObj = new bootstrap.Modal(document.getElementById('modalEnumerator'));
    supervisionModalObj = new bootstrap.Modal(document.getElementById('modalSupervision'));
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('enumeratorForm').addEventListener('submit', submitEnumeratorForm);
    document.getElementById('supervisionForm').addEventListener('submit', submitSupervisionForm);
    initializeEnumeratorForm();
    const savedUser = sessionStorage.getItem('dashboardUser');
    if (sessionToken && savedUser) {
      try { showDashboard(JSON.parse(savedUser)); } catch (e) { logout(); }
    } else {
      showLogin();
    }
  });

  function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    const button = document.getElementById('loginButton');
    const errorBox = document.getElementById('loginError');

    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Memeriksa...';
    errorBox.hidden = true;

    google.script.run
      .withSuccessHandler(result => {
        if (!result || !result.success) {
          errorBox.textContent = result ? result.message : 'Login gagal.';
          errorBox.hidden = false;
          button.disabled = false;
          button.innerHTML = '<i class="bi bi-box-arrow-in-right me-2"></i>Masuk';
          return;
        }
        sessionToken = result.token;
        currentUser = result.user;
        sessionStorage.setItem('dashboardSessionToken', sessionToken);
        sessionStorage.setItem('dashboardUser', JSON.stringify(currentUser));
        showDashboard(currentUser);
      })
      .withFailureHandler(error => {
        errorBox.textContent = 'Tidak dapat menghubungi server: ' + error.message;
        errorBox.hidden = false;
        button.disabled = false;
        button.innerHTML = '<i class="bi bi-box-arrow-in-right me-2"></i>Masuk';
      })
      .authenticateUser(username, password);
  }

  function showLogin() {
    document.getElementById('loginView').hidden = false;
    document.getElementById('appView').hidden = true;
    document.getElementById('loginUsername').focus();
  }

  function showDashboard(user) {
    currentUser = user;
    const roleKey = String(user.role || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    canEditQC = user.canEditQC === true || roleKey.includes('dataanalis') || roleKey.includes('dataanalyst') || roleKey.includes('koordinator') || roleKey.includes('kordinator') || roleKey.includes('supervisor');
    canSupervise = roleKey.includes('supervisor') || roleKey.includes('koordinator') || roleKey.includes('kordinator');
    document.getElementById('enumeratorInputButton').hidden = roleKey !== 'enumerator';
    document.getElementById('loginView').hidden = true;
    document.getElementById('appView').hidden = false;
    document.getElementById('userDisplay').textContent = user.name;
    document.getElementById('roleDisplay').textContent = user.role ? '(' + user.role + ')' : '';
    document.getElementById('qc_nama_pemeriksa').value = user.name;
    initMap();
    loadData();
  }

  function openEnumeratorForm() {
    if (!currentUser || String(currentUser.role || '').trim().toLowerCase() !== 'enumerator') return;
    document.getElementById('enumeratorForm').reset();
    document.getElementById('enum_nama_enumerator').value = currentUser.name;
    document.getElementById('enum_kelurahan').disabled = true;
    document.getElementById('enum_kelurahan').innerHTML = '<option value="">Pilih kecamatan dulu</option>';
    document.getElementById('enum_sub_tipe_lokasi').innerHTML = '<option value="">Pilih tipe utama dulu</option>';
    document.getElementById('enum_tipe_lokasi_lainnya_wrap').hidden = true;
    enumeratorModalObj.show();
  }

  function openSupervisionForm(selectedId, selectedName) {
    const roleKey = String(currentUser && currentUser.role || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!roleKey.includes('supervisor') && !roleKey.includes('koordinator') && !roleKey.includes('kordinator')) return;
    if (!selectedId) return showNotice('Pilih data supervisi', 'Klik tombol Supervisi pada baris data yang akan diperiksa.', 'info');
    document.getElementById('supervisionForm').reset();
    document.getElementById('sup_submission_id').value = String(selectedId);
    document.getElementById('sup_nama_hotspot').value = selectedName ? String(selectedName) : '';
    document.getElementById('sup_nama_supervisor').value = currentUser ? currentUser.name : '';
    document.getElementById('sup_nama_pemeriksa').value = currentUser ? currentUser.name : '';
    document.getElementById('sup_pengesahan_nama_supervisor').value = currentUser ? currentUser.name : '';
    document.getElementById('sup_tanggal_supervisi').value = new Date().toISOString().slice(0, 10);
    document.getElementById('sup_pengesahan_tanggal_supervisor').value = new Date().toISOString().slice(0, 10);
    supervisionModalObj.show();
  }

  function submitSupervisionForm(event) {
    event.preventDefault();
    const form = document.getElementById('supervisionForm');
    if (!form.reportValidity()) return;
    const file = document.getElementById('sup_dokumentasi').files[0];
    const button = document.getElementById('btnSaveSupervision');
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Menyimpan...';

    const collectRadioValues = (namePrefix, total) => {
      const values = [];
      for (let i = 1; i <= total; i++) {
        const checked = document.querySelector(`input[name="${namePrefix}_${i}"]:checked`);
        values.push(checked ? checked.value : '');
      }
      return values;
    };

    const collectConclusion = () => {
      const checked = document.querySelectorAll('input[type="checkbox"][id^="sup_kesimpulan_"]:checked');
      if (!checked.length) return '';
      const values = Array.from(checked).map(item => item.value);
      if (values.includes('pelaksanaan_sesuai_standar_dan_dapat_dilanjutkan')) return 'valid';
      if (values.includes('diperlukan_perbaikan_sebelum_proses_dilanjutkan')) return 'perlu_tindak_lanjut';
      if (values.includes('diperlukan_tindak_lanjut_khusus')) return 'tidak_valid';
      return 'valid';
    };

    const send = fileData => {
      const supervisionData = {
        submissionId: document.getElementById('sup_submission_id').value,
        namaHotspot: document.getElementById('sup_nama_hotspot').value.trim(),
        tanggalSupervisi: document.getElementById('sup_tanggal_supervisi').value,
        lokasiWilayah: document.getElementById('sup_lokasi_wilayah').value.trim(),
        namaSupervisor: document.getElementById('sup_nama_supervisor').value.trim(),
        namaEnumerator: document.getElementById('sup_nama_enumerator').value.trim(),
        komunitasOrganisasi: document.getElementById('sup_komunitas_organisasi').value.trim(),
        jumlahHotspot: document.getElementById('sup_jumlah_hotspot').value,
        sup_pelaksanaan_1: collectRadioValues('sup_pelaksanaan', 7)[0],
        sup_pelaksanaan_2: collectRadioValues('sup_pelaksanaan', 7)[1],
        sup_pelaksanaan_3: collectRadioValues('sup_pelaksanaan', 7)[2],
        sup_pelaksanaan_4: collectRadioValues('sup_pelaksanaan', 7)[3],
        sup_pelaksanaan_5: collectRadioValues('sup_pelaksanaan', 7)[4],
        sup_pelaksanaan_6: collectRadioValues('sup_pelaksanaan', 7)[5],
        sup_pelaksanaan_7: collectRadioValues('sup_pelaksanaan', 7)[6],
        sup_kualitas_1: collectRadioValues('sup_kualitas', 5)[0],
        sup_kualitas_2: collectRadioValues('sup_kualitas', 5)[1],
        sup_kualitas_3: collectRadioValues('sup_kualitas', 5)[2],
        sup_kualitas_4: collectRadioValues('sup_kualitas', 5)[3],
        sup_kualitas_5: collectRadioValues('sup_kualitas', 5)[4],
        temuanSupervisi: document.getElementById('sup_temuan_supervisi').value.trim(),
        kendalaLapangan: document.getElementById('sup_kendala_lapangan').value.trim(),
        perbaikanYangDibutuhkan: document.getElementById('sup_perbaikan_dibutuhkan').value.trim(),
        tindakLanjut: document.getElementById('sup_tindak_lanjut').value.trim(),
        kesimpulanSupervisi: collectConclusion(),
        pengesahanNamaEnumerator: document.getElementById('sup_pengesahan_nama_enumerator').value.trim(),
        pengesahanNamaSupervisor: document.getElementById('sup_pengesahan_nama_supervisor').value.trim(),
        pengesahanTanggalEnumerator: document.getElementById('sup_pengesahan_tanggal_enumerator').value,
        pengesahanTanggalSupervisor: document.getElementById('sup_pengesahan_tanggal_supervisor').value,
        statusFinal: collectConclusion(),
        documentationData: fileData ? fileData.data : '',
        documentationName: fileData ? fileData.name : '',
        documentationMime: fileData ? fileData.mime : ''
      };

      google.script.run.withSuccessHandler(result => {
        showNotice(result && result.success ? 'Supervisi tersimpan' : 'Supervisi belum tersimpan', result ? result.message : 'Data selesai diproses.', result && result.success ? 'success' : 'warning');
        button.disabled = false;
        button.innerHTML = '<i class="bi bi-save me-2"></i>Simpan Supervisi';
        if (result && result.success) supervisionModalObj.hide();
      }).withFailureHandler(error => {
        handleSessionError(error);
        button.disabled = false;
        button.innerHTML = '<i class="bi bi-save me-2"></i>Simpan Supervisi';
      }).saveSupervision(sessionToken, supervisionData);
    };

    if (!file) return send(null);
    const reader = new FileReader();
    reader.onload = () => send({ data: reader.result.split(',')[1], name: file.name, mime: file.type });
    reader.onerror = () => {
      showNotice('Dokumentasi gagal dibaca', 'Pilih file dokumentasi lain.', 'warning');
      button.disabled = false;
      button.innerHTML = '<i class="bi bi-save me-2"></i>Simpan Supervisi';
    };
    reader.readAsDataURL(file);
  }

  async function fillRandomEnumeratorData() {
    const randomFrom = arr => arr[Math.floor(Math.random() * arr.length)];
    const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    const kecamatanMap = {
      blimbing: ['arjosari', 'balearjosari', 'bimbing', 'kesatrian', 'polehan'],
      kedungkandang: ['arjowinangun', 'buring', 'kedungkandang', 'madyopuro', 'sawojajar'],
      klojen: ['bareng', 'kasin', 'kauman', 'klojen', 'oro_oro_dowo'],
      lowokwaru: ['dinoyo', 'jatimulyo', 'ketawanggede', 'lowokwaru', 'tlogomas'],
      sukun: ['bandulan', 'gadang', 'kebonsari', 'sukun', 'tanjungrejo']
    };

    const kecamatan = randomFrom(Object.keys(kecamatanMap));
    const kelurahan = randomFrom(kecamatanMap[kecamatan]);
    const tipeLokasi = randomFrom(['ruang_publik', 'tempat_makan_hiburan', 'akomodasi_private', 'perawatan_kebugaran', 'platform_virtual', 'lainnya']);
    const statusHotspot = randomFrom(['aktif', 'baru', 'tidak_aktif', 'perlu_klarifikasi', 'lama']);
    const sourceInformasi = randomFrom(['populasi_kunci', 'tokoh_kunci', 'observasi', 'lainnya']);
    const organisasi = randomFrom(['lgi', 'igama', 'wamarapa', 'fatayat_nu']);

    document.getElementById('enum_organisasi_pelaksana').value = organisasi;
    document.getElementById('enum_nama_hotspot').value = `Hotspot ${randomFrom(['Malam', 'Pusat', 'Sore', 'Kampung', 'Baru', 'Kunci'])} ${randomInt(1, 99)}`;
    document.getElementById('enum_kecamatan').value = kecamatan;
    updateKelurahanOptions();
    setTimeout(() => {
      document.getElementById('enum_kelurahan').value = kelurahan;
    }, 20);

    document.getElementById('enum_alamat_lengkap').value = `Jln. ${randomFrom(['Soekarno Hatta', 'Bunga', 'Candi', 'Suryo', 'Raya Tlogomas', 'Mayjen Sungkono'])} No. ${randomInt(10, 200)} ${randomFrom(['RT 02', 'RW 01', 'Kec. Malang', 'Dekat pasar', 'Depan gang'])}`;
    const lat = -7.95 + (Math.random() * 0.12);
    const lng = 112.58 + (Math.random() * 0.17);
    document.getElementById('enum_titik_koordinat').value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    document.getElementById('enum_status_hotspot').value = statusHotspot;
    document.getElementById('enum_sumber_informasi').value = sourceInformasi;
    document.getElementById('enum_no_hp_informan').value = `08${randomInt(100000000, 999999999)}`;
    document.getElementById('enum_keterangan_aktivitas').value = randomFrom(['Mencari pelanggan', 'Aktivitas malam hari', 'Berinteraksi dengan komunitas', 'Transaksi rutin', 'Kegiatan nongkrong']);
    document.getElementById('enum_kondisi_saat_pemetaan').value = randomFrom(['Kondisi ramai dan terpantau', 'Cukup padat dengan beberapa titik aktivitas', 'Tampak aktif namun belum terlalu ramai', 'Aktivitas sedang berlangsung']);
    document.getElementById('enum_estimasi_jumlah_populasi').value = String(randomInt(10, 90));
    document.getElementById('enum_jumlah_diedukasi').value = String(randomInt(5, 40));
    document.getElementById('enum_jumlah_tes_hiv').value = String(randomInt(2, 35));
    document.getElementById('enum_jumlah_hiv_positif').value = String(randomInt(0, 8));
    document.getElementById('enum_catatan_lapangan').value = 'Uji coba otomatis untuk validasi form dan alur submit data.';

    document.querySelectorAll('input[name="enum_populasi_kunci"]').forEach(input => {
      input.checked = Math.random() > 0.5;
    });
    document.querySelectorAll('input[name="enum_waktu_aktivitas"]').forEach(input => {
      input.checked = Math.random() > 0.5;
    });

    const selectedPop = Array.from(document.querySelectorAll('input[name="enum_populasi_kunci"]:checked')).map(input => input.value);
    const selectedTime = Array.from(document.querySelectorAll('input[name="enum_waktu_aktivitas"]:checked')).map(input => input.value);
    if (!selectedPop.length) {
      document.querySelector('input[name="enum_populasi_kunci"][value="lsl"]').checked = true;
    }
    if (!selectedTime.length) {
      document.querySelector('input[name="enum_waktu_aktivitas"][value="malam"]').checked = true;
    }

    document.getElementById('enum_tipe_lokasi').value = tipeLokasi;
    updateSubTypeOptions();
    setTimeout(() => {
      const subTipe = document.getElementById('enum_sub_tipe_lokasi');
      if (subTipe && subTipe.options.length > 1) {
        subTipe.value = subTipe.options[randomInt(1, subTipe.options.length - 1)].value;
      }
      if (tipeLokasi === 'lainnya') {
        document.getElementById('enum_tipe_lokasi_lainnya').value = 'Lokasi uji coba';
      }
    }, 30);

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 420;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#dff8f5';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0f9f94';
      ctx.fillRect(30, 30, 180, 120);
      ctx.fillStyle = '#f3f6fb';
      ctx.fillRect(230, 30, 360, 180);
      ctx.fillStyle = '#172235';
      ctx.font = 'bold 32px Arial';
      ctx.fillText('HOTSPOT TEST', 260, 110);
      ctx.font = '20px Arial';
      ctx.fillText('Foto dokumentasi uji coba', 260, 160);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (blob) {
        const file = new File([blob], 'foto-uji-coba.jpg', { type: 'image/jpeg' });
        const dt = new DataTransfer();
        dt.items.add(file);
        document.getElementById('enum_foto_lokasi').files = dt.files;
      }
    } catch (e) {
      console.warn('Auto-fill foto test gagal:', e);
    }
  }

  function initializeEnumeratorForm() {
    const kecamatanOptions = [
      ['blimbing', 'Kecamatan Blimbing'], ['kedungkandang', 'Kecamatan Kedungkandang'],
      ['klojen', 'Kecamatan Klojen'], ['lowokwaru', 'Kecamatan Lowokwaru'], ['sukun', 'Kecamatan Sukun']
    ];
    populateOptions('enum_kecamatan', kecamatanOptions, 'Pilih kecamatan');
    document.getElementById('enum_kecamatan').addEventListener('change', updateKelurahanOptions);
    document.getElementById('enum_tipe_lokasi').addEventListener('change', updateSubTypeOptions);
  }

  function populateOptions(selectId, options, placeholder) {
    const select = document.getElementById(selectId);
    select.innerHTML = `<option value="">${placeholder}</option>` + options.map(option => `<option value="${escapeHtml(option[0])}">${escapeHtml(option[1])}</option>`).join('');
  }

  function updateKelurahanOptions() {
    const kecamatan = document.getElementById('enum_kecamatan').value;
    const kelurahan = {
      blimbing: [['arjosari','Kel. Arjosari'],['balearjosari','Kel. Balearjosari'],['blimbing','Kel. Blimbing'],['bunulrejo','Kel. Bunulrejo'],['jodipan','Kel. Jodipan'],['kesatrian','Kel. Kesatrian'],['pandanwangi','Kel. Pandanwangi'],['polehan','Kel. Polehan'],['polowijen','Kel. Polowijen'],['purwantoro','Kel. Purwantoro'],['purwodadi','Kel. Purwodadi']],
      kedungkandang: [['arjowinangun','Kel. Arjowinangun'],['bumiayu','Kel. Bumiayu'],['buring','Kel. Buring'],['cemorokandang','Kel. Cemorokandang'],['kedungkandang','Kel. Kedungkandang'],['kotalama','Kel. Kotalama'],['lesanpuro','Kel. Lesanpuro'],['madyopuro','Kel. Madyopuro'],['mergosono','Kel. Mergosono'],['sawojajar','Kel. Sawojajar'],['tlogowaru','Kel. Tlogowaru'],['wonokoyo','Kel. Wonokoyo']],
      klojen: [['bareng','Kel. Bareng'],['gadingasri','Kel. Gadingasri'],['kasin','Kel. Kasin'],['kauman','Kel. Kauman'],['kiduldalem','Kel. Kiduldalem'],['klojen','Kel. Klojen'],['oro_oro_dowo','Kel. Oro-Oro Dowo'],['penanggungan','Kel. Penanggungan'],['rampal_celaket','Kel. Rampal Celaket'],['samaan','Kel. Samaan'],['sukoharjo','Kel. Sukoharjo']],
      lowokwaru: [['dinoyo','Kel. Dinoyo'],['jatimulyo','Kel. Jatimulyo'],['karangbesuki','Kel. Karangbesuki'],['ketawanggede','Kel. Ketawanggede'],['lowokwaru','Kel. Lowokwaru'],['merjosari','Kel. Merjosari'],['mojolangu','Kel. Mojolangu'],['sumbersari','Kel. Sumbersari'],['tasikmadu','Kel. Tasikmadu'],['tlogomas','Kel. Tlogomas'],['tulusrejo','Kel. Tulusrejo'],['tunggulwulung','Kel. Tunggulwulung']],
      sukun: [['bakalankrajan','Kel. Bakalankrajan'],['bandulan','Kel. Bandulan'],['bandungrejosari','Kel. Bandungrejosari'],['ciptomulyo','Kel. Ciptomulyo'],['gadang','Kel. Gadang'],['kebonsari','Kel. Kebonsari'],['mulyorejo','Kel. Mulyorejo'],['pisangcandi','Kel. Pisangcandi'],['sukun','Kel. Sukun'],['tanjungrejo','Kel. Tanjungrejo']]
    };
    const select = document.getElementById('enum_kelurahan');
    select.disabled = !kecamatan;
    populateOptions('enum_kelurahan', kelurahan[kecamatan] || [], kecamatan ? 'Pilih kelurahan' : 'Pilih kecamatan dulu');
  }

  function updateSubTypeOptions() {
    const tipe = document.getElementById('enum_tipe_lokasi').value;
    const subTypes = {
      ruang_publik: [['jalanan_mangkal','Jalanan / Titik Mangkal'],['taman_kota','Taman Kota / Alun-Alun / Halaman'],['stasiun_terminal','Stasiun / Terminal / Halte'],['bangunan_kosong','Bangunan Kosong / Mangkrak'],['ruang_publik_lainnya','Lainnya']],
      tempat_makan_hiburan: [['warung_makan','Warung Kopi / Warung Makan'],['kafe_restoran','Kafe / Restoran'],['bar_club','Bar / Club / Diskotik'],['karaoke','Karaoke (Hall / Room)'],['tempat_makan_lainnya','Lainnya']],
      akomodasi_private: [['kos_apartemen','Kos / Apartemen'],['rumah_tinggal','Rumah Tinggal / Kontrakan'],['penginapan_hotel','Penginapan / Hotel / Losmen'],['akomodasi_lainnya','Lainnya']],
      perawatan_kebugaran: [['salon','Salon'],['spa_gym','Spa / Sauna / Gym'],['panti_pijat','Panti Pijat'],['perawatan_lainnya','Lainnya']],
      platform_virtual: [['aplikasi_kencan','Aplikasi Kencan'],['media_sosial','Media Sosial & Grup Chat'],['virtual_lainnya','Lainnya']],
      lainnya: [['lainnya','Lainnya']]
    };
    populateOptions('enum_sub_tipe_lokasi', subTypes[tipe] || [], tipe ? 'Pilih sub-tipe lokasi' : 'Pilih tipe utama dulu');
    document.getElementById('enum_tipe_lokasi_lainnya_wrap').hidden = tipe !== 'lainnya';
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) return showNotice('GPS tidak tersedia', 'Browser tidak mendukung GPS.', 'warning');
    navigator.geolocation.getCurrentPosition(position => {
      document.getElementById('enum_titik_koordinat').value = `${position.coords.latitude}, ${position.coords.longitude}`;
    }, error => showNotice('GPS tidak dapat dibaca', error.message, 'warning'), { enableHighAccuracy: true, timeout: 10000 });
  }

  function submitEnumeratorForm(event) {
    event.preventDefault();
    const form = document.getElementById('enumeratorForm');
    if (!form.reportValidity()) return;
    const selectedValues = name => Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(input => input.value);
    const populasi = selectedValues('enum_populasi_kunci');
    const waktu = selectedValues('enum_waktu_aktivitas');
    if (!populasi.length || !waktu.length) return showNotice('Data belum lengkap', 'Pilih minimal satu populasi kunci dan satu waktu aktivitas.', 'warning');

    const photo = document.getElementById('enum_foto_lokasi').files[0];
    const reader = new FileReader();
    const button = document.getElementById('btnSubmitEnumerator');
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Mengirim...';
    reader.onload = () => {
      const formData = {
        organisasi_pelaksana: document.getElementById('enum_organisasi_pelaksana').value,
        nama_hotspot: document.getElementById('enum_nama_hotspot').value,
        kecamatan: document.getElementById('enum_kecamatan').value,
        kelurahan: document.getElementById('enum_kelurahan').value,
        alamat_lengkap: document.getElementById('enum_alamat_lengkap').value,
        titik_koordinat: document.getElementById('enum_titik_koordinat').value,
        foto_lokasi: photo.name,
        fotoData: reader.result.split(',')[1], fotoName: photo.name, fotoMime: photo.type,
        status_hotspot: document.getElementById('enum_status_hotspot').value,
        populasi_kunci: populasi.join(' '),
        tipe_lokasi: document.getElementById('enum_tipe_lokasi').value,
        sub_tipe_lokasi: document.getElementById('enum_sub_tipe_lokasi').value,
        tipe_lokasi_lainnya: document.getElementById('enum_tipe_lokasi_lainnya').value,
        waktu_aktivitas: waktu.join(' '),
        estimasi_jumlah_populasi: document.getElementById('enum_estimasi_jumlah_populasi').value,
        jumlah_diedukasi: document.getElementById('enum_jumlah_diedukasi').value,
        jumlah_tes_hiv: document.getElementById('enum_jumlah_tes_hiv').value,
        jumlah_hiv_positif: document.getElementById('enum_jumlah_hiv_positif').value,
        catatan_lapangan: document.getElementById('enum_catatan_lapangan').value,
        sumber_informasi: document.getElementById('enum_sumber_informasi').value,
        no_hp_informan: document.getElementById('enum_no_hp_informan').value,
        keterangan_aktivitas: document.getElementById('enum_keterangan_aktivitas').value,
        kondisi_saat_pemetaan: document.getElementById('enum_kondisi_saat_pemetaan').value
      };
      google.script.run.withSuccessHandler(result => {
        showNotice(result && result.success ? 'Data berhasil disimpan' : 'Data belum tersimpan', result ? result.message : 'Data selesai diproses.', result && result.success ? 'success' : 'warning');
        button.disabled = false;
        button.innerHTML = '<i class="bi bi-cloud-upload me-2"></i>Simpan Data Pemetaan';
        if (result && result.success) { enumeratorModalObj.hide(); loadData(); }
      }).withFailureHandler(error => {
        handleSessionError(error);
        button.disabled = false;
        button.innerHTML = '<i class="bi bi-cloud-upload me-2"></i>Simpan Data Pemetaan';
      }).submitEnumeratorForm(sessionToken, formData);
    };
    reader.readAsDataURL(photo);
  }

  function logout() {
    const tokenToClear = sessionToken;
    sessionToken = null;
    currentUser = null;
    sessionStorage.removeItem('dashboardSessionToken');
    sessionStorage.removeItem('dashboardUser');
    if (tokenToClear) google.script.run.logoutUser(tokenToClear);
    if (map) { map.remove(); map = null; markersGroup = null; }
    showLogin();
  }

  function initMap() {
    map = L.map('map').setView([-7.9666, 112.6326], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    markersGroup = L.layerGroup().addTo(map);
  }

  function loadData() {
    document.querySelector('#dataTable tbody').innerHTML = '<tr><td colspan="7" class="text-center py-5"><div class="spinner-border text-primary spinner-border-sm me-2"></div>Memuat data...</td></tr>';
    google.script.run.withSuccessHandler(renderDashboard).withFailureHandler(handleSessionError).getSheetData(sessionToken);
  }

  function handleSessionError(error) {
    if (error && error.message && error.message.toLowerCase().includes('sesi')) {
      showNotice('Sesi berakhir', error.message, 'warning');
      logout();
      return;
    }
    showNotice('Terjadi kesalahan', 'Error Server:\n' + (error ? error.message : 'Terjadi kesalahan.'), 'danger');
  }

  function renderDashboard(data) {
    if (!data || data.error) { showNotice('Data tidak dapat dimuat', 'Error Spreadsheet:\n' + (data ? data.error : 'Data kosong'), 'danger'); return; }

    let tTotal = data.length, tAktif = 0, tQcPending = 0, tTes = 0, tPositif = 0, kecCounts = {}, tbodyHtml = '';
    markersGroup.clearLayers();

    data.forEach(row => {
      let subId = row['_id'], nama = row['sec_b/nama_hotspot'] || 'Tanpa Nama', kec = row['sec_b/kecamatan'] || '-';
      let kel = row['sec_b/kelurahan'] || '', pop = row['sec_c/populasi_kunci'] || '-';
      let statusFisik = String(row['sec_c/status_hotspot'] || '').toLowerCase();
      let qcStatus = row['sec_e/qc_status_final'] || 'belum_divalidasi';
      
      // Hitung KPI (Mendukung teks 'aktif' & 'baru')
      if (statusFisik === '1' || statusFisik === 'aktif' || statusFisik === '2' || statusFisik === 'baru') tAktif++;
      if (!qcStatus || qcStatus === 'belum_divalidasi' || qcStatus === 'perlu_tindak_lanjut') tQcPending++;
      tTes += parseInt(row['sec_c/jumlah_tes_hiv'] || 0); tPositif += parseInt(row['sec_c/jumlah_hiv_positif'] || 0);
      
      let kecLabel = humanize(kec);
      kecCounts[kecLabel] = (kecCounts[kecLabel] || 0) + 1;

      // Peta
      let gps = row['sec_b/titik_koordinat'] || row['_geolocation'];
      if (gps) {
        let pts = gps.replace('[','').replace(']','').split(/[\s,]+/);
        if(pts.length>=2) L.marker([parseFloat(pts[0]), parseFloat(pts[1])]).addTo(markersGroup).bindPopup(`<b>${escapeHtml(nama)}</b><br><small>${escapeHtml(kecLabel)}</small>`);
      }

      let qcDataStr = encodeURIComponent(JSON.stringify({ kelengkapan: row['sec_e/qc_kelengkapan']||'', duplikasi: row['sec_e/qc_duplikasi']||'', kroscek: row['sec_e/qc_kroscek']||'', catatan: row['sec_e/qc_catatan_analis']||'', pemeriksa: row['sec_e/qc_nama_pemeriksa']||'' }));
      let actions = [];
      if (canEditQC) actions.push(`<button class="btn btn-sm btn-outline-primary" onclick='openQC(${escapeHtml(JSON.stringify(subId))}, ${escapeHtml(JSON.stringify(nama))}, ${escapeHtml(JSON.stringify(qcStatus))}, ${escapeHtml(JSON.stringify(qcDataStr))})'><i class="bi bi-shield-check me-1"></i>QC Analis</button>`);
      if (canSupervise) actions.push(`<button class="btn btn-sm btn-outline-warning" onclick='openSupervisionForm(${escapeHtml(JSON.stringify(subId))}, ${escapeHtml(JSON.stringify(nama))})'><i class="bi bi-clipboard-check me-1"></i>Supervisi</button>`);
      let qcAction = actions.length ? actions.join(' ') : '<span class="badge bg-light text-secondary border"><i class="bi bi-eye me-1"></i>Lihat Saja</span>';

      tbodyHtml += `<tr>
        <td class="text-center font-monospace text-secondary">${escapeHtml(subId)}</td><td class="fw-bold">${escapeHtml(nama)}</td>
        <td>${escapeHtml(kecLabel)} <small class="text-muted d-block">${escapeHtml(humanize(kel))}</small></td>
        <td class="text-center"><span class="badge bg-secondary">${escapeHtml(humanize(pop))}</span></td>
        <td class="text-center">${formatStatusFisik(statusFisik)}</td>
        <td class="text-center">${formatStatusQC(qcStatus)}</td>
        <td class="text-center">${qcAction}</td>
      </tr>`;
    });

    document.getElementById('kpi-total').innerText = tTotal; document.getElementById('kpi-aktif').innerText = tAktif;
    document.getElementById('kpi-qc').innerText = tQcPending; document.getElementById('kpi-hiv').innerHTML = `${tPositif} <small class="fs-5 text-muted">/ ${tTes} Tes</small>`;
    document.querySelector('#dataTable tbody').innerHTML = tbodyHtml || '<tr><td colspan="7" class="text-center py-4">Data tidak ditemukan.</td></tr>';

    let ctx = document.getElementById('chartKecamatan').getContext('2d');
    if (chartKec) chartKec.destroy();
    chartKec = new Chart(ctx, { type: 'doughnut', data: { labels: Object.keys(kecCounts), datasets: [{ data: Object.values(kecCounts), backgroundColor: ['#0d6efd', '#198754', '#ffc107', '#dc3545', '#0dcaf0', '#6c757d'] }] }, options: { responsive: true, maintainAspectRatio: false } });
  }

  function formatStatusFisik(code) {
    if (code === 'aktif' || code === '1') return '<span class="badge bg-success badge-status">Aktif</span>';
    if (code === 'baru' || code === '2') return '<span class="badge bg-info text-dark badge-status">Baru</span>';
    if (code === 'tidak_aktif' || code === '3') return '<span class="badge bg-danger badge-status">Tidak Aktif</span>';
    if (code === 'lama' || code === '5') return '<span class="badge bg-primary badge-status">Lama</span>';
    return '<span class="badge bg-secondary badge-status">Perlu Klarifikasi</span>';
  }

  function formatStatusQC(code) {
    if (code === 'valid') return '<span class="badge bg-success badge-status"><i class="bi bi-check-circle me-1"></i>Valid</span>';
    if (code === 'tidak_valid') return '<span class="badge bg-danger badge-status"><i class="bi bi-x-circle me-1"></i>Ditolak</span>';
    if (code === 'perlu_tindak_lanjut') return '<span class="badge bg-warning text-dark badge-status">Cek Ulang (Pending)</span>';
    return '<span class="badge bg-light text-dark border badge-status">Belum Diperiksa</span>';
  }

  function openQC(subId, nama, currentStatus, rawQcData) {
    document.getElementById('formQC').reset();
    document.getElementById('btnSaveQC').innerHTML = '<i class="bi bi-cloud-upload me-2"></i>Simpan ke Kobo';
    document.getElementById('btnSaveQC').disabled = false;
    document.getElementById('qc_submission_id').value = subId; document.getElementById('qc_nama_hotspot').value = nama;
    if (currentStatus && currentStatus !== 'belum_divalidasi') document.getElementById('qc_status_final').value = currentStatus;
    try {
      let hist = JSON.parse(decodeURIComponent(rawQcData));
      if (hist.kelengkapan) document.getElementById('qc_kelengkapan').value = hist.kelengkapan;
      if (hist.duplikasi) document.getElementById('qc_duplikasi').value = hist.duplikasi;
      if (hist.kroscek) document.getElementById('qc_kroscek').value = hist.kroscek;
      if (hist.catatan) document.getElementById('qc_catatan_analis').value = hist.catatan;
    } catch(e) {}
    document.getElementById('qc_nama_pemeriksa').value = currentUser ? currentUser.name : '';
    qcModalObj.show();
  }

  function submitQCForm() {
    if (!canEditQC) return showNotice('Akses ditolak', 'Role Anda tidak memiliki izin untuk melakukan QC.', 'danger');
    if (!document.getElementById('formQC').reportValidity()) return;
    let payload = { statusFinal: document.getElementById('qc_status_final').value, kelengkapan: document.getElementById('qc_kelengkapan').value, duplikasi: document.getElementById('qc_duplikasi').value, kroscek: document.getElementById('qc_kroscek').value, catatanAnalis: document.getElementById('qc_catatan_analis').value, namaPemeriksa: document.getElementById('qc_nama_pemeriksa').value };
    if (!payload.statusFinal) return showNotice('Data belum lengkap', 'Pilih Keputusan Final QC.', 'warning');
    if (!payload.namaPemeriksa) return showNotice('Data belum lengkap', 'Masukkan Nama Anda.', 'warning');

    let btn = document.getElementById('btnSaveQC'); btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Menyimpan...'; btn.disabled = true;

    google.script.run.withSuccessHandler(res => {
      if (!res || !res.success) {
        showNotice('QC belum tersimpan', res ? res.message : 'Gagal menyimpan QC.', 'danger');
        btn.innerHTML = 'Coba Lagi';
        btn.disabled = false;
        return;
      }
      qcModalObj.hide();
      showNotice('QC berhasil disimpan', res.message, 'success');
      loadData();
    })
      .withFailureHandler(handleSessionError)
      .saveQCValidation(sessionToken, document.getElementById('qc_submission_id').value, payload);
  }

  function filterTable() { let input = document.getElementById("searchInput").value.toLowerCase(); document.querySelectorAll("#dataTable tbody tr").forEach(row => { row.style.display = row.innerText.toLowerCase().includes(input) ? "" : "none"; }); }
  function showNotice(title, message, type = 'info') {
    const iconByType = { info: 'bi-info-circle-fill', success: 'bi-check-circle-fill', warning: 'bi-exclamation-triangle-fill', danger: 'bi-x-circle-fill' };
    const notice = document.getElementById('noticeModal');
    const noticeIcon = document.getElementById('noticeIcon');
    noticeIcon.className = `notice-icon notice-${iconByType[type] ? type : 'info'}`;
    noticeIcon.innerHTML = `<i class="bi ${iconByType[type] || iconByType.info}"></i>`;
    document.getElementById('noticeTitle').textContent = title || 'Pemberitahuan';
    document.getElementById('noticeMessage').textContent = message || '';
    notice.classList.add('show');
  }

  function hideNotice() {
    const notice = document.getElementById('noticeModal');
    if (notice) notice.classList.remove('show');
  }
  function humanize(value) {
    return String(value || '')
      .replace(/_+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, character => character.toUpperCase());
  }
  function escapeHtml(text) { return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;").replace(/"/g, "&quot;"); }
