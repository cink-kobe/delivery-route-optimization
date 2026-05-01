import React, { useState, useEffect, useCallback, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { 
  Navigation, Truck, Clock, Plus, Trash2, ChevronUp, ChevronDown, 
  Play, CheckCircle, Coffee, LogOut, History, Info, Map as MapIcon, 
  AlertCircle, RefreshCw, Settings, X, Key, Download, Edit3,
  Camera, Mic, MicOff, FileText, ImageIcon, Hash, Save, AlertTriangle,
  GripVertical, QrCode, PlayCircle
} from 'lucide-react';

// --- Firebase Initialization ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  projectId: "sixth-well-319809",
  storageBucket: "sixth-well-319809.firebasestorage.app",
  messagingSenderId: "332779419872",
  appId: "1:332779419872:web:599f1274c7e94e1eddb885",
  measurementId: "G-SKHL0LXPSC"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'delivery-route-app';

const SHIFT_STATUS = ["勤務開始", "勤務終了"];
const VEHICLE_TYPES = ["普通車", "軽自動車", "小型車", "中型車", "大型車", "単車", "自転車"];
const TIME_WINDOWS = [
  "指定なし", "08:00 - 12:00", "12:00 - 14:00", "14:00 - 16:00", 
  "16:00 - 18:00", "18:00 - 20:00", "19:00 - 21:00"
];

const App = () => {
  // --- Auth State ---
  const [user, setUser] = useState(null);

  // --- State Management ---
  const [currentApiKey, setCurrentApiKey] = useState(() => (localStorage.getItem('delivery_api_key') || "").trim());
  const [showSettings, setShowSettings] = useState(false);
  const [tempApiKey, setTempApiKey] = useState(currentApiKey);
  const [plateNumber, setPlateNumber] = useState(() => localStorage.getItem('delivery_plate_no') || "");
  const [statusOptions, setStatusOptions] = useState(() => {
    const saved = localStorage.getItem('delivery_status_options');
    return saved ? JSON.parse(saved) : ["輸送中", "休憩中", "作業中"];
  });
  
  const [hasExported, setHasExported] = useState(true);
  const [alertMessage, setAlertMessage] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [showScanner, setShowScanner] = useState(false);

  const initialStopTemplate = () => ({
    id: `stop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    address: '',
    okihai: false,
    timeWindow: '指定なし',
    memo: '',
    images: [], 
    audioUrl: null,
    nextLeg: null,
    arrivalTime: null,   
    departureTime: null, 
    actualTime: null     
  });

  const [stops, setStops] = useState([]);
  const [currentStatus, setCurrentStatus] = useState("輸送中");
  const [vehicle, setVehicle] = useState("普通車");
  const [shiftStatus, setShiftStatus] = useState("準備中");
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [error, setError] = useState(null);

  // --- Recording State ---
  const [isRecording, setIsRecording] = useState(null);
  const mediaRecorder = useRef(null);
  const audioChunks = useRef([]);

  // --- Drag & Drop ---
  const [draggedIndex, setDraggedIndex] = useState(null);

  const mapRef = useRef(null);
  const googleMap = useRef(null);
  const directionsService = useRef(null);
  const directionsRenderer = useRef(null);
  const geocoder = useRef(null);
  const scannerRef = useRef(null);

  // --- Auth Setup (RULE 3) ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.error("Firebase Auth Error:", e);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- QR Scanner Script ---
  useEffect(() => {
    if (!document.getElementById('qr-code-script')) {
      const script = document.createElement('script');
      script.id = 'qr-code-script';
      script.src = "https://unpkg.com/html5-qrcode";
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  // --- Persistence ---
  useEffect(() => { localStorage.setItem('delivery_plate_no', plateNumber); }, [plateNumber]);
  useEffect(() => { localStorage.setItem('delivery_api_key', currentApiKey); }, [currentApiKey]);
  useEffect(() => { localStorage.setItem('delivery_status_options', JSON.stringify(statusOptions)); }, [statusOptions]);

  // --- Measurement ---
  useEffect(() => {
    if (stops.length === 0) return;
    const targetIdx = stops.findIndex(s => s.address && !s.departureTime);
    if (targetIdx === -1) return;

    const now = new Date();
    const updatedStops = [...stops];

    if (currentStatus === "作業中" && !updatedStops[targetIdx].arrivalTime) {
      updatedStops[targetIdx].arrivalTime = now.getTime();
      setStops(updatedStops);
    } else if (currentStatus === "輸送中" && updatedStops[targetIdx].arrivalTime && !updatedStops[targetIdx].departureTime) {
      updatedStops[targetIdx].departureTime = now.getTime();
      const diffMs = updatedStops[targetIdx].departureTime - updatedStops[targetIdx].arrivalTime;
      const mins = Math.floor(diffMs / 60000);
      const secs = Math.floor((diffMs % 60000) / 1000);
      updatedStops[targetIdx].actualTime = `${mins}分${secs}秒`;
      setStops(updatedStops);
    }
  }, [currentStatus, stops.length]);

  // --- Map logic ---
  const getCurrentLocation = useCallback(() => {
    const defaultShinjuku = { lat: 35.6895, lng: 139.6917 };
    const setInitialStop = (lat, lng) => {
      if (geocoder.current) {
        geocoder.current.geocode({ location: { lat, lng } }, (results, status) => {
          const addr = (status === "OK" && results[0]) ? results[0].formatted_address : `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
          setStops([{ ...initialStopTemplate(), address: addr }]);
        });
      } else {
        setStops([{ ...initialStopTemplate(), address: `${lat.toFixed(6)}, ${lng.toFixed(6)}` }]);
      }
    };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setInitialStop(pos.coords.latitude, pos.coords.longitude),
        () => setInitialStop(defaultShinjuku.lat, defaultShinjuku.lng),
        { enableHighAccuracy: true, timeout: 5000 }
      );
    } else {
      setInitialStop(defaultShinjuku.lat, defaultShinjuku.lng);
    }
  }, []);

  const initMapInstance = useCallback(() => {
    if (!mapRef.current || !window.google || !window.google.maps) return;
    if (googleMap.current) return;
    try {
      googleMap.current = new window.google.maps.Map(mapRef.current, {
        center: { lat: 35.6895, lng: 139.6917 },
        zoom: 14,
        disableDefaultUI: false,
      });
      geocoder.current = new window.google.maps.Geocoder();
      directionsService.current = new window.google.maps.DirectionsService();
      directionsRenderer.current = new window.google.maps.DirectionsRenderer({
        map: googleMap.current,
        suppressMarkers: false,
      });
      googleMap.current.addListener("click", (e) => {
        if (!geocoder.current) return;
        geocoder.current.geocode({ location: e.latLng }, (results, status) => {
          const address = (status === "OK" && results[0]) ? results[0].formatted_address : `${e.latLng.lat().toFixed(6)}, ${e.latLng.lng().toFixed(6)}`;
          setStops(prev => [...prev, { ...initialStopTemplate(), address }]);
        });
      });
      setIsMapLoaded(true);
      setError(null);
      if (stops.length === 0) getCurrentLocation();
    } catch (err) { 
      setError("地図の初期化に失敗しました。APIキーを確認してください。"); 
    }
  }, [getCurrentLocation, stops.length]);

  useEffect(() => {
    const CALLBACK_NAME = 'initMapsCallback';
    window[CALLBACK_NAME] = () => initMapInstance();

    // InvalidKeyMapError 回避のため、キーが空の場合は読み込まない
    if (!currentApiKey || currentApiKey.trim().length < 10) {
      setError("Google Maps APIキーが設定されていません。設定から入力してください。");
      return;
    }

    if (window.google && window.google.maps) {
      initMapInstance();
      return;
    }

    if (!document.getElementById('google-maps-api')) {
      const script = document.createElement('script');
      script.id = 'google-maps-api';
      script.src = `https://maps.googleapis.com/maps/api/js?key=${currentApiKey.trim()}&libraries=places&callback=${CALLBACK_NAME}`;
      script.async = true;
      script.onerror = () => setError("Google Maps APIの読み込みに失敗しました。");
      document.head.appendChild(script);
    }
  }, [currentApiKey, initMapInstance]);

  // --- ルート計算 (時間指定ソートの厳密化) ---
  const calculateRoute = useCallback(() => {
    if (!directionsService.current || stops.length < 2) return;
    
    const validStops = stops.filter(s => s.address.trim() !== "");
    if (validStops.length < 2) return;

    const origin = validStops[0];
    const destinations = validStops.slice(1);

    // 時間指定に基づく詳細ソート
    destinations.sort((a, b) => {
      const getMinutes = (tw) => {
        if (!tw || tw === "指定なし") return 9999;
        const match = tw.match(/(\d{2}):(\d{2})/);
        return match ? parseInt(match[1]) * 60 + parseInt(match[2]) : 9999;
      };
      
      const aMin = getMinutes(a.timeWindow);
      const bMin = getMinutes(b.timeWindow);
      
      if (aMin !== bMin) return aMin - bMin;
      if (a.okihai !== b.okihai) return a.okihai ? -1 : 1;
      return 0;
    });

    const finalSequence = [origin, ...destinations];

    // optimizeWaypoints: false にして自前の順序を強制する
    directionsService.current.route({
      origin: finalSequence[0].address,
      destination: finalSequence[finalSequence.length - 1].address,
      waypoints: finalSequence.slice(1, -1).map(s => ({ location: s.address, stopover: true })),
      optimizeWaypoints: false, 
      travelMode: window.google.maps.TravelMode.DRIVING,
      drivingOptions: { 
        departureTime: new Date(Date.now() + 120000), 
        trafficModel: 'bestguess' 
      }
    }, (result, status) => {
      if (status === "OK") {
        directionsRenderer.current.setDirections(result);
        const routeLegs = result.routes[0].legs;
        const stopsWithLegData = finalSequence.map((s, idx) => ({
          ...s,
          nextLeg: routeLegs[idx] ? { 
            distance: routeLegs[idx].distance.text, 
            duration: routeLegs[idx].duration.text 
          } : null
        }));
        setStops(stopsWithLegData);
      } else { 
        setAlertMessage(`ルート計算失敗: ${status}. APIキーの権限や有効期限を確認してください。`); 
      }
    });
  }, [stops]);

  // --- QR Scanner ---
  const startScanner = () => {
    setShowScanner(true);
    setTimeout(() => {
      if (!document.getElementById('reader')) return;
      const html5QrCode = new window.Html5Qrcode("reader");
      scannerRef.current = html5QrCode;
      html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          setStops(prev => [...prev, { ...initialStopTemplate(), address: decodedText }]);
          stopScanner();
        },
        () => {}
      ).catch(err => console.error(err));
    }, 500);
  };

  const stopScanner = () => {
    if (scannerRef.current) {
      scannerRef.current.stop().then(() => {
        setShowScanner(false);
        scannerRef.current = null;
      }).catch(() => setShowScanner(false));
    } else {
      setShowScanner(false);
    }
  };

  // --- Drag & Drop ---
  const onDragStart = (idx) => setDraggedIndex(idx);
  const onDragOver = (e) => e.preventDefault();
  const onDrop = (idx) => {
    if (draggedIndex === null) return;
    const newStops = [...stops];
    const item = newStops.splice(draggedIndex, 1)[0];
    newStops.splice(idx, 0, item);
    setStops(newStops);
    setDraggedIndex(null);
  };

  // --- Audio ---
  const handleAudioRecording = async (stopId) => {
    if (isRecording === stopId) {
      if (mediaRecorder.current && mediaRecorder.current.state !== "inactive") {
        mediaRecorder.current.stop();
      }
      setIsRecording(null);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder.current = new MediaRecorder(stream);
        audioChunks.current = [];
        mediaRecorder.current.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.current.push(e.data); };
        mediaRecorder.current.onstop = () => {
          const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
          const audioUrl = URL.createObjectURL(audioBlob);
          setStops(prev => prev.map(s => s.id === stopId ? { ...s, audioUrl } : s));
          stream.getTracks().forEach(track => track.stop());
        };
        mediaRecorder.current.start();
        setIsRecording(stopId);
      } catch (err) { 
        setAlertMessage("マイクが利用できません。権限を確認してください。"); 
      }
    }
  };

  // --- Cloud sync ---
  const saveToCloud = async (logData) => {
    if (!user) return;
    try {
      const logsRef = collection(db, 'artifacts', appId, 'public', 'data', 'logs');
      for (const s of logData.route) {
        await addDoc(logsRef, {
          plateNo: logData.plateNo,
          logDate: logData.date,
          address: s.address,
          timeWindow: s.timeWindow,
          okihai: s.okihai,
          memo: s.memo,
          imageUrls: s.images || [], 
          audioUrl: s.audioUrl || null,
          distance: s.nextLeg?.distance || null,
          estimatedTime: s.nextLeg?.duration || null,
          actualTime: s.actualTime || null,
          arrivalTime: s.arrivalTime ? new Date(s.arrivalTime).toLocaleTimeString() : null,
          departureTime: s.departureTime ? new Date(s.departureTime).toLocaleTimeString() : null,
          isExported: true,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid
        });
      }
    } catch (e) { 
      console.error("Cloud save failed:", e); 
      setAlertMessage("クラウド保存に失敗しました。権限設定を確認してください。");
    }
  };

  const handleFullReset = async () => {
    if (history.length > 0 && !hasExported) {
      setAlertMessage("csv出力後でないと全てリセットされません。");
      return;
    }
    setConfirmDialog({
      title: "全リセットの確認",
      message: "クラウドへの保存を行い、全てのデータをリセットしますか？",
      onConfirm: async () => {
        if (!user) return;
        for (const h of history) await saveToCloud(h);
        setHistory([]);
        setStops([]);
        setShiftStatus("準備中");
        setCurrentStatus("輸送中");
        setHasExported(true); 
        if (directionsRenderer.current) {
          directionsRenderer.current.setDirections({ routes: [] });
          directionsRenderer.current.setMap(null);
        }
        setTimeout(() => {
          if (directionsRenderer.current) directionsRenderer.current.setMap(googleMap.current);
          getCurrentLocation();
          setShowHistory(false);
          setConfirmDialog(null);
        }, 300);
      }
    });
  };

  const handleShiftChange = (status) => {
    setShiftStatus(status);
    if (status === "勤務終了") {
      const snapshot = JSON.parse(JSON.stringify(stops));
      const logEntry = {
        id: `log-${Date.now()}`,
        date: new Date().toLocaleString('ja-JP'),
        plateNo: plateNumber,
        route: snapshot
      };
      setHistory(prev => [...prev, logEntry]);
      setHasExported(false); 
      setShowHistory(true);
    }
  };

  const downloadCSV = () => {
    if (history.length === 0) return;
    let csv = "\uFEFFプレート№,日付,地点,住所,時間指定,置き配,メモ,到着時刻,出発時刻,実配達時間,区間距離,予想時間\n";
    history.forEach(entry => {
      entry.route.forEach((s, idx) => {
        const arrT = s.arrivalTime ? new Date(s.arrivalTime).toLocaleTimeString() : "-";
        const depT = s.departureTime ? new Date(s.departureTime).toLocaleTimeString() : "-";
        csv += `"${entry.plateNo}","${entry.date}",${String.fromCharCode(65 + idx)},"${(s.address || "").replace(/"/g, '""')}","${s.timeWindow}","${s.okihai ? '可' : '不可'}","${(s.memo || "").replace(/"/g, '""')}","${arrT}","${depT}","${s.actualTime || "-"}","${s.nextLeg?.distance || '-'}","${s.nextLeg?.duration || '-'}"\n`;
      });
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${new Date().toISOString().slice(0,10).replace(/-/g,'')}_配送実績.csv`;
    link.click();
    setHasExported(true); 
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden text-[14px]">
      <header className="bg-blue-700 text-white p-4 shadow-lg flex justify-between items-center z-30">
        <div className="flex items-center gap-2">
          <Navigation className="w-5 h-5" />
          <h1 className="font-bold text-[15px]">配送マネージャー Pro</h1>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowSettings(true)} className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors">
            <Settings className="w-5 h-5" />
          </button>
          <select 
            className="bg-blue-800 text-xs rounded-full px-3 py-1.5 outline-none font-bold cursor-pointer border border-blue-400"
            value={shiftStatus}
            onChange={(e) => handleShiftChange(e.target.value)}
          >
            <option value="準備中">待機中</option>
            {SHIFT_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </header>

      <div className="relative w-full h-[25vh] bg-slate-200 shadow-inner">
        <div ref={mapRef} className="w-full h-full" />
        {(!isMapLoaded || error) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100 gap-3 p-4 text-center">
             {error ? (
                <>
                    <AlertCircle className="w-8 h-8 text-red-500" />
                    <p className="text-xs text-red-600 font-bold leading-relaxed">{error}</p>
                    <button onClick={() => setShowSettings(true)} className="text-xs text-blue-600 font-black underline mt-2">設定からAPIキーを入力</button>
                </>
             ) : (
                <>
                    <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
                    <p className="text-xs text-slate-400 font-bold">地図を読込中...</p>
                </>
             )}
          </div>
        )}
      </div>

      <main className="flex-1 overflow-y-auto p-4 pb-32">
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap gap-4 items-center sticky top-0 z-20 backdrop-blur-md">
            <div className="flex items-center gap-2 grow min-w-[200px]">
              <Truck className="w-4 h-4 text-blue-600" />
              <select className="font-bold outline-none cursor-pointer bg-slate-50 px-2 py-1 rounded-lg" value={vehicle} onChange={e => setVehicle(e.target.value)}>
                {VEHICLE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <div className="h-6 w-[1px] bg-slate-200 mx-2" />
              <div className="relative grow">
                <Hash className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="プレート№" 
                  className="w-full pl-7 py-1 font-bold outline-none border-b border-transparent focus:border-blue-400"
                  value={plateNumber}
                  onChange={e => setPlateNumber(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 ml-auto">
              <button onClick={startScanner} title="QRスキャン" className="bg-slate-100 text-slate-600 p-2.5 rounded-xl hover:bg-slate-200 transition-all shadow-sm">
                <QrCode className="w-5 h-5" />
              </button>
              <button onClick={calculateRoute} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-700 active:scale-95 shadow-md">
                <Play className="w-4 h-4 fill-current" /> ルート計算
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center px-1">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <MapIcon className="w-3 h-3" /> 配送リスト (ドラッグで微調整)
              </span>
              <button onClick={() => setStops([...stops, initialStopTemplate()])} className="bg-white p-1.5 rounded-lg border shadow-sm text-blue-600 hover:scale-110"><Plus className="w-4 h-4"/></button>
            </div>

            {stops.map((stop, idx) => (
              <div 
                key={stop.id} 
                draggable={idx > 0}
                onDragStart={() => onDragStart(idx)}
                onDragOver={onDragOver}
                onDrop={() => onDrop(idx)}
                className={`bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden transition-all ${draggedIndex === idx ? 'opacity-40 scale-95 shadow-inner' : 'opacity-100'}`}
              >
                <div className="p-4 flex gap-3 border-b border-slate-50">
                  <div className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 flex items-center shrink-0">
                    <GripVertical className="w-5 h-5" />
                  </div>
                  <div className={`flex flex-col items-center justify-center rounded-xl px-2.5 text-[11px] font-black h-10 w-10 shrink-0 ${idx === 0 ? 'bg-orange-500 text-white border-orange-600 shadow-sm' : 'bg-blue-50 text-blue-600 border border-blue-100'}`}>
                    {idx === 0 ? '始' : String.fromCharCode(65 + idx)}
                  </div>
                  <div className="flex-1 space-y-1">
                    <input 
                      className="w-full font-bold outline-none border-b border-transparent focus:border-blue-400 py-1" 
                      value={stop.address} 
                      onChange={e => setStops(stops.map(s => s.id === stop.id ? {...s, address: e.target.value} : s))}
                      placeholder={idx === 0 ? "出発地点(現在地)" : "住所を入力..."}
                    />
                    <div className="flex gap-2 text-[10px] font-bold">
                      {stop.nextLeg && <span className="text-slate-400">区間: {stop.nextLeg.distance} / {stop.nextLeg.duration}</span>}
                      {stop.actualTime && <span className="text-green-600 flex items-center gap-1"><CheckCircle className="w-3 h-3"/> 実作業: {stop.actualTime}</span>}
                    </div>
                  </div>
                  {idx > 0 && (
                    <button onClick={() => setStops(stops.filter(s => s.id !== stop.id))} className="text-slate-300 hover:text-red-500 p-2 transition-colors shrink-0">
                      <Trash2 className="w-4 h-4"/>
                    </button>
                  )}
                </div>

                <div className="p-4 bg-slate-50/30 grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={stop.okihai} 
                        onChange={e => setStops(stops.map(s => s.id === stop.id ? {...s, okihai: e.target.checked} : s))}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-xs font-bold text-slate-600">置き配許可</span>
                    </label>
                    <div className="space-y-1">
                      <span className="text-[9px] font-black text-slate-300 uppercase tracking-tighter">時間指定</span>
                      <select 
                        value={stop.timeWindow}
                        onChange={e => setStops(stops.map(s => s.id === stop.id ? {...s, timeWindow: e.target.value} : s))}
                        className="w-full bg-white border border-slate-100 rounded-lg p-2 text-xs font-bold outline-none shadow-xs cursor-pointer focus:border-blue-300 transition-colors"
                      >
                        {TIME_WINDOWS.map(tw => <option key={tw} value={tw}>{tw}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-3 border-l border-slate-100 pl-4">
                    <div className="flex gap-2">
                      <label className="flex-1 bg-white border border-slate-100 rounded-xl p-2 flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-blue-50 transition-colors shadow-xs relative overflow-hidden h-12">
                        <Camera className="w-4 h-4 text-slate-400" />
                        <span className="text-[9px] font-black text-slate-400 uppercase">画像追加</span>
                        <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => {
                          const files = Array.from(e.target.files);
                          files.forEach(file => {
                            const reader = new FileReader();
                            reader.onload = () => setStops(prev => prev.map(s => s.id === stop.id ? {...s, images: [...(s.images || []), reader.result]} : s));
                            reader.readAsDataURL(file);
                          });
                        }} />
                      </label>
                      <button 
                        onClick={() => handleAudioRecording(stop.id)}
                        className={`flex-1 border rounded-xl p-2 flex flex-col items-center justify-center gap-1 transition-all shadow-xs h-12 ${isRecording === stop.id ? 'bg-red-50 border-red-200 animate-pulse' : 'bg-white border-slate-100 hover:bg-blue-50'}`}
                      >
                        {isRecording === stop.id ? <MicOff className="w-4 h-4 text-red-500" /> : <Mic className={`w-4 h-4 ${stop.audioUrl ? 'text-blue-600' : 'text-slate-400'}`} />}
                        <span className="text-[9px] font-black text-slate-400 uppercase">{isRecording === stop.id ? '録音中' : (stop.audioUrl ? '録音済' : '録音')}</span>
                      </button>
                    </div>
                    {stop.images && stop.images.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {stop.images.map((img, i) => (
                          <div key={i} className="relative w-8 h-8 rounded border border-slate-200 overflow-hidden shadow-sm">
                            <img src={img} alt="" className="w-full h-full object-cover" />
                            <button onClick={() => setStops(prev => prev.map(s => s.id === stop.id ? {...s, images: s.images.filter((_, idx) => idx !== i)} : s))} className="absolute top-0 right-0 bg-black/60 text-white p-0.5 hover:bg-red-500 transition-colors"><X className="w-2 h-2"/></button>
                          </div>
                        ))}
                      </div>
                    )}
                    <textarea 
                      className="w-full bg-white border border-slate-100 rounded-xl p-2 text-[11px] font-bold outline-none focus:border-blue-300 h-16 resize-none shadow-xs transition-colors"
                      placeholder="メモを入力..."
                      value={stop.memo}
                      onChange={e => setStops(stops.map(s => s.id === stop.id ? {...s, memo: e.target.value} : s))}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 p-4 bg-white/90 backdrop-blur-md border-t border-slate-200 z-40">
        <div className="max-w-md mx-auto flex gap-3 items-center">
          <div className="flex-1 bg-slate-100 rounded-[1.5rem] p-2 flex items-center gap-3 border border-slate-200/50 shadow-inner">
             <div className={`p-2.5 rounded-xl text-white shadow-lg transition-colors duration-300 ${currentStatus === '作業中' ? 'bg-orange-500' : 'bg-blue-600'}`}>
               {currentStatus === '作業中' ? <Clock className="w-4 h-4"/> : <Truck className="w-4 h-4"/>}
             </div>
             <select 
              className="bg-transparent font-black outline-none flex-1 cursor-pointer text-slate-700" 
              value={currentStatus} 
              onChange={e => setCurrentStatus(e.target.value)}
             >
                {statusOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
             </select>
          </div>
          <button onClick={() => setShowHistory(true)} className="bg-slate-900 text-white p-4.5 rounded-[1.5rem] hover:bg-slate-800 transition-all active:scale-95 shadow-xl">
            <History className="w-6 h-6" />
          </button>
        </div>
      </footer>

      {showSettings && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in duration-300">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-black flex items-center gap-2 text-lg text-slate-800"><Settings className="w-5 h-5 text-blue-600" /> 設定</h3>
              <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-slate-100 rounded-full transition-colors"><X className="w-5 h-5 text-slate-400"/></button>
            </div>
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Google Maps API Key</label>
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input type="password" value={tempApiKey} onChange={e => setTempApiKey(e.target.value)} className="w-full bg-slate-50 p-4 pl-12 rounded-2xl border border-slate-200 outline-none focus:border-blue-500 shadow-inner transition-all" placeholder="Keyを入力..."/>
                </div>
                <button onClick={() => { setCurrentApiKey(tempApiKey.trim()); setShowSettings(false); setError(null); }} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-sm shadow-xl hover:bg-blue-700 transition-all active:scale-95">保存して適用</button>
              </div>
              <div className="h-[1px] bg-slate-100" />
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ステータス項目の管理</label>
                <div className="space-y-2">
                  {statusOptions.map((opt, i) => (
                    <div key={i} className="flex gap-2">
                      <input 
                        value={opt} 
                        onChange={e => {
                          const n = [...statusOptions];
                          n[i] = e.target.value;
                          setStatusOptions(n);
                        }} 
                        className="flex-1 bg-slate-50 p-3 rounded-xl text-xs font-bold border border-slate-200 outline-none shadow-sm focus:border-blue-300 transition-colors"
                      />
                      <button onClick={() => setStatusOptions(statusOptions.filter((_, idx) => idx !== i))} className="text-red-400 p-2 hover:bg-red-50 rounded-xl transition-colors">
                        <Trash2 className="w-4 h-4"/>
                      </button>
                    </div>
                  ))}
                </div>
                <button onClick={() => setStatusOptions([...statusOptions, "新規項目"])} className="w-full border-2 border-dashed border-slate-200 text-slate-400 py-3 rounded-xl text-xs font-black hover:border-blue-200 hover:text-blue-600 transition-all">+ 追加</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showScanner && (
        <div className="fixed inset-0 bg-black z-[100] flex flex-col items-center justify-center p-6">
          <div className="w-full max-w-sm bg-white rounded-3xl overflow-hidden relative shadow-2xl">
            <button onClick={stopScanner} className="absolute top-4 right-4 z-[110] bg-black/50 text-white p-2 rounded-full hover:bg-red-500 transition-colors"><X className="w-6 h-6"/></button>
            <div id="reader" className="w-full aspect-square" />
            <div className="p-6 text-center">
              <p className="font-black text-slate-800">QR/バーコードをスキャン</p>
              <p className="text-xs text-slate-400 mt-2 italic">住所が含まれるコードを読み取ります</p>
            </div>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-end justify-center">
          <div className="bg-white w-full max-w-xl rounded-t-[3.5rem] p-8 max-h-[90vh] overflow-y-auto shadow-2xl animate-in slide-in-from-bottom duration-500">
            <div className="w-16 h-1.5 bg-slate-200 rounded-full mx-auto mb-10 shadow-inner" />
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-black flex items-center gap-3 text-blue-600"><History className="w-7 h-7"/> 実績ログ</h3>
              <div className="flex gap-3">
                <button onClick={downloadCSV} className="bg-green-600 text-white px-5 py-2.5 rounded-2xl text-xs font-black flex items-center gap-2 shadow-lg shadow-green-100 hover:bg-green-700 active:scale-95 transition-all">
                  <Download className="w-4 h-4" /> CSV出力
                </button>
                <button onClick={() => setShowHistory(false)} className="bg-slate-100 p-2.5 rounded-xl hover:bg-slate-200 transition-colors"><X className="w-6 h-6 text-slate-500"/></button>
              </div>
            </div>
            {history.length === 0 ? <p className="text-center py-24 text-slate-400 font-bold italic opacity-60">実績はありません</p> : (
              <div className="space-y-8 pb-10">
                {history.map((h) => (
                  <div key={h.id} className="bg-slate-50 p-8 rounded-[2.5rem] space-y-6 border border-slate-200 shadow-inner animate-in fade-in duration-300">
                    <div className="flex justify-between items-center">
                       <p className="font-black text-blue-600 text-[10px] uppercase tracking-widest bg-blue-50 w-fit px-4 py-1.5 rounded-full shadow-sm">{h.date}</p>
                       <p className="text-[10px] font-bold text-slate-400 italic">Plate: {h.plateNo || "---"}</p>
                    </div>
                    <div className="space-y-6">
                      {h.route.map((s, idx) => (
                        <div key={idx} className="flex gap-5 group">
                          <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-[11px] font-black shadow-md shrink-0 border ${idx === 0 ? 'bg-orange-500 text-white border-orange-600' : 'bg-white text-slate-800 border-slate-100'}`}>
                            {idx === 0 ? '始' : String.fromCharCode(65 + idx)}
                          </span>
                          <div className="flex-1">
                            <p className="font-bold text-slate-800 leading-tight group-hover:text-blue-600 transition-colors">{s.address}</p>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {s.actualTime && <span className="text-[9px] font-black bg-green-100 text-green-700 px-2 py-0.5 rounded shadow-sm">作業時間: {s.actualTime}</span>}
                              {s.timeWindow !== '指定なし' && <span className="text-[9px] font-black bg-blue-100 text-blue-600 px-2 py-0.5 rounded shadow-sm">{s.timeWindow}</span>}
                              {s.okihai && <span className="text-[9px] font-black bg-slate-200 text-slate-600 px-2 py-0.5 rounded shadow-sm">置き配可</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="sticky bottom-0 bg-white pt-4 pb-4 border-t border-slate-100">
              <button className="w-full py-6 bg-red-50 text-red-600 rounded-[2rem] font-black hover:bg-red-100 transition-all border-2 border-red-100 border-dashed active:scale-95 flex items-center justify-center gap-2 shadow-sm" onClick={handleFullReset}>
                <Trash2 className="w-5 h-5"/> 全てをリセットしてクラウド保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Dialogs */}
      {alertMessage && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[200] flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-white w-full max-w-xs rounded-[2rem] p-8 shadow-2xl space-y-6 text-center animate-in zoom-in duration-200">
            <div className="bg-red-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto"><AlertTriangle className="text-red-500 w-8 h-8" /></div>
            <p className="font-black text-slate-800 leading-relaxed text-sm">{alertMessage}</p>
            <button onClick={() => setAlertMessage(null)} className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black shadow-xl active:scale-95 transition-all">OK</button>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[200] flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-white w-full max-w-xs rounded-[2rem] p-8 shadow-2xl space-y-6 text-center animate-in zoom-in duration-200">
            <div className="bg-blue-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto"><Info className="text-blue-500 w-8 h-8" /></div>
            <div className="space-y-2"><h4 className="font-black text-lg">{confirmDialog.title}</h4><p className="text-xs font-bold text-slate-500 leading-relaxed">{confirmDialog.message}</p></div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDialog(null)} className="flex-1 bg-slate-100 text-slate-500 py-4 rounded-2xl font-black active:scale-95 transition-all">閉じる</button>
              <button onClick={confirmDialog.onConfirm} className="flex-1 bg-red-500 text-white py-4 rounded-2xl font-black shadow-lg active:scale-95 transition-all shadow-red-100">保存してリセット</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;