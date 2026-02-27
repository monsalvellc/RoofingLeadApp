import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, arrayUnion, collection, doc, getDoc, onSnapshot, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { auth, db, storage } from '../../config/firebaseConfig';
import { Customer, Job, JobFile, JobMedia } from '../../types';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const STATUS_COLORS: Record<string, string> = {
  Lead: '#1976d2',
  Retail: '#0288d1',
  Inspected: '#7b1fa2',
  'Claim Filed': '#f57c00',
  'Met with Adjuster': '#e65100',
  'Partial Approval': '#fbc02d',
  'Full Approval': '#388e3c',
  Production: '#6a1b9a',
  'Pending Payment': '#ff8f00',
  'Delinquent Payment': '#c62828',
  Completed: '#00838f',
};

const STATUSES: Job['status'][] = [
  'Lead',
  'Retail',
  'Inspected',
  'Claim Filed',
  'Met with Adjuster',
  'Partial Approval',
  'Full Approval',
  'Production',
  'Pending Payment',
  'Delinquent Payment',
  'Completed',
];

const AVAILABLE_TRADES = ['Roofing', 'Gutters', 'Siding', 'Windows', 'Skylights', 'Solar'];

const FILE_SECTIONS: { type: JobFile['type']; label: string }[] = [
  { type: 'inspection', label: 'Inspection Photos' },
  { type: 'install', label: 'Install Photos' },
  { type: 'document', label: 'Documents' },
];

const VIEWER_PHOTO_HEIGHT = SCREEN_HEIGHT - 140;

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [job, setJob] = useState<Job | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // File edit modal
  const [selectedFile, setSelectedFile] = useState<JobFile | null>(null);
  const [editingType, setEditingType] = useState<JobFile['type']>('inspection');
  const [editingShared, setEditingShared] = useState(false);

  // Full-screen viewer
  const [viewingMediaIdx, setViewingMediaIdx] = useState<number | null>(null);
  const [viewingMediaList, setViewingMediaList] = useState<JobMedia[]>([]);

  // Media edit modal
  const [selectedMedia, setSelectedMedia] = useState<JobMedia | null>(null);
  const [editingMediaShared, setEditingMediaShared] = useState(false);

  // Edit details modal
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Job>>({});

  // Add payment modal
  const [isAddingPayment, setIsAddingPayment] = useState(false);
  const [newPaymentAmount, setNewPaymentAmount] = useState('');

  // Customer's other jobs
  const [customerJobs, setCustomerJobs] = useState<any[]>([]);
  const [isCreatingJob, setIsCreatingJob] = useState(false);

  // Job tabs
  const [activeJobTab, setActiveJobTab] = useState<'details' | 'media'>('details');

  // Stable refs required by FlatList — must not be recreated on render
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0 && viewableItems[0].index !== null) {
      setViewingMediaIdx(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  useEffect(() => {
    const fetchData = async () => {
      try {
        const jobSnap = await getDoc(doc(db, 'jobs', id));
        if (!jobSnap.exists()) {
          setIsLoading(false);
          return;
        }
        const jobData = { id: jobSnap.id, ...jobSnap.data() } as Job;
        setJob(jobData);

        if (jobData.customerId) {
          const customerSnap = await getDoc(doc(db, 'customers', jobData.customerId));
          if (customerSnap.exists()) {
            setCustomer({ id: customerSnap.id, ...customerSnap.data() } as Customer);
          }
        }
      } catch (e) {
        console.error('Failed to fetch job detail:', e);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [id]);

  useEffect(() => {
    if (!job?.customerId) return;
    const q = query(
      collection(db, 'jobs'),
      where('customerId', '==', job.customerId),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setCustomerJobs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [job?.customerId]);

  const handleCreateAdditionalJob = async () => {
    if (!job || isCreatingJob) return;
    setIsCreatingJob(true);
    try {
      const newJobPayload = {
        companyId: job.companyId,
        customerId: job.customerId,
        customerName: job.customerName,
        customerPhone: job.customerPhone || '',
        assignedUserIds: job.assignedUserIds || [],
        status: 'Lead',
        contractAmount: 0,
        balance: 0,
        createdAt: Date.now(),
      };
      const docRef = await addDoc(collection(db, 'jobs'), newJobPayload);
      router.setParams({ id: docRef.id });
    } catch (e) {
      console.error('Failed to create additional job:', e);
    } finally {
      setIsCreatingJob(false);
    }
  };

  const updateJobStatus = async (newStatus: Job['status']) => {
    if (!job || isUpdating) return;
    setIsUpdating(true);
    try {
      const payload: Record<string, any> = { status: newStatus };
      if (newStatus === 'Completed') {
        payload.completedAt = new Date().toISOString();
      } else {
        payload.completedAt = null;
      }
      await updateDoc(doc(db, 'jobs', id), payload);
      setJob((prev) => prev ? { ...prev, status: newStatus, completedAt: payload.completedAt } : prev);
    } catch (e) {
      console.error('Failed to update status:', e);
    } finally {
      setIsUpdating(false);
    }
  };

  const openFileModal = (file: JobFile) => {
    setSelectedFile(file);
    setEditingType(file.type);
    setEditingShared(file.isSharedWithCustomer);
  };

  const openMediaModal = (media: JobMedia) => {
    setSelectedMedia(media);
    setEditingMediaShared(media.shared);
  };

  const handleUpdateMedia = async () => {
    if (!selectedMedia || !job) return;
    const photoField = selectedMedia.category === 'inspection' ? 'inspectionPhotos' : 'installPhotos';
    const updatedMedia: JobMedia = { ...selectedMedia, shared: editingMediaShared };
    const updatedList = ((job as any)[photoField] as JobMedia[]).map((m: JobMedia) =>
      m.id === selectedMedia.id ? updatedMedia : m,
    );
    try {
      await updateDoc(doc(db, 'jobs', id), { [photoField]: updatedList });
      setJob((prev) => prev ? { ...prev, [photoField]: updatedList } : prev);
      setSelectedMedia(null);
    } catch (e) {
      console.error('Failed to update media:', e);
      Alert.alert('Error', 'Could not update photo.');
    }
  };

  const handleUpdateFile = async () => {
    if (!selectedFile || !job) return;
    const updatedFile: JobFile = {
      ...selectedFile,
      type: editingType,
      isSharedWithCustomer: editingShared,
    };
    const updatedFiles = (job.files as any[]).map((f: any) =>
      f.id === selectedFile.id ? updatedFile : f,
    );
    try {
      await updateDoc(doc(db, 'jobs', id), { files: updatedFiles });
      setJob((prev) => prev ? { ...prev, files: updatedFiles as any } : prev);
      setSelectedFile(null);
    } catch (e) {
      console.error('Failed to update file:', e);
      Alert.alert('Error', 'Could not update file.');
    }
  };

  const handleDownloadMedia = async (url: string, fileName: string) => {
    try {
      const fileUri = (FileSystem.documentDirectory ?? '') + fileName;
      const { uri } = await FileSystem.downloadAsync(url, fileUri);
      await Sharing.shareAsync(uri);
    } catch (e) {
      console.error('Download failed:', e);
      Alert.alert('Download Failed', 'Could not download the file. Please try again.');
    }
  };

  const handleAddDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
      if (result.canceled) return;

      setIsUploading(true);

      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();

      const docRef = ref(storage, `jobs/${id}/${Date.now()}_${asset.name}`);
      await uploadBytes(docRef, blob);
      const downloadUrl = await getDownloadURL(docRef);

      const newDoc: JobFile = {
        id: Date.now().toString(),
        url: downloadUrl,
        name: asset.name,
        type: 'document',
        isSharedWithCustomer: false,
        createdAt: new Date().toISOString(),
      };
      await updateDoc(doc(db, 'jobs', id), { files: arrayUnion(newDoc) });
      setJob((prev) => prev ? { ...prev, files: [...(prev.files ?? []), newDoc as any] } : prev);
    } catch (e) {
      console.error('Document upload failed:', e);
      Alert.alert('Upload Failed', 'Could not upload document. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  // Pure storage helper — uploads one image and returns a JobMedia object.
  // Does NOT touch isUploading or Firestore; callers handle that.
  const processAndUploadImage = async (
    uri: string,
    photoType: 'inspectionPhotos' | 'installPhotos',
    uniqueSuffix?: string,
  ): Promise<JobMedia> => {
    const response = await fetch(uri);
    const blob = await response.blob();
    const mediaId = uniqueSuffix ? `${Date.now()}_${uniqueSuffix}` : Date.now().toString();
    const imageRef = ref(storage, `jobs/${id}/${photoType}/${mediaId}`);
    await uploadBytes(imageRef, blob);
    const downloadUrl = await getDownloadURL(imageRef);
    return {
      id: mediaId,
      url: downloadUrl,
      category: photoType === 'inspectionPhotos' ? 'inspection' : 'install',
      shared: false,
      uploadedAt: new Date().toISOString(),
    };
  };

  const handleAddPhoto = async (photoType: 'inspectionPhotos' | 'installPhotos') => {
    const userDocRef = doc(db, 'users', auth.currentUser?.uid ?? '');
    const userDocSnap = await getDoc(userDocRef);
    const userData = userDocSnap.data();
    const isHd = userData?.allowHdToggle === true && userData?.hdPhotosEnabled === true;
    const imageQuality = isHd ? 1 : 0.75;

    Alert.alert('Add Photo', 'Choose an option', [
      {
        text: 'Camera',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permission Required', 'Camera access is needed to take photos.');
            return;
          }
          const result = await ImagePicker.launchCameraAsync({ quality: imageQuality });
          if (!result.canceled) {
            setIsUploading(true);
            try {
              const newMedia = await processAndUploadImage(result.assets[0].uri, photoType);
              await updateDoc(doc(db, 'jobs', id), { [photoType]: arrayUnion(newMedia) });
              setJob((prev) =>
                prev ? { ...prev, [photoType]: [...((prev as any)[photoType] ?? []), newMedia] } : prev,
              );
            } catch (e) {
              console.error('Photo upload failed:', e);
              Alert.alert('Upload Failed', 'Could not upload photo. Please try again.');
            } finally {
              setIsUploading(false);
            }
          }
        },
      },
      {
        text: 'Gallery',
        onPress: async () => {
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: imageQuality,
            allowsMultipleSelection: true,
            selectionLimit: 10,
          });
          if (!result.canceled) {
            setIsUploading(true);
            try {
              const newMediaArray = await Promise.all(
                result.assets.map((asset, i) =>
                  processAndUploadImage(asset.uri, photoType, String(i)),
                ),
              );
              await updateDoc(doc(db, 'jobs', id), { [photoType]: arrayUnion(...newMediaArray) });
              setJob((prev) =>
                prev
                  ? { ...prev, [photoType]: [...((prev as any)[photoType] ?? []), ...newMediaArray] }
                  : prev,
              );
            } catch (e) {
              console.error('Photo upload failed:', e);
              Alert.alert('Upload Failed', 'Could not upload photos. Please try again.');
            } finally {
              setIsUploading(false);
            }
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleDeletePhoto = (media: JobMedia) => {
    const photoField = media.category === 'inspection' ? 'inspectionPhotos' : 'installPhotos';
    Alert.alert('Delete Photo', 'Are you sure you want to delete this photo?', [
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!job) return;
          try {
            const updatedList = ((job as any)[photoField] as JobMedia[]).filter((m) => m.id !== media.id);
            await updateDoc(doc(db, 'jobs', id), { [photoField]: updatedList });
            setJob((prev) => prev ? { ...prev, [photoField]: updatedList } : prev);
            try {
              await deleteObject(ref(storage, media.url));
            } catch (storageErr) {
              console.warn('Could not delete from storage:', storageErr);
            }
          } catch (e) {
            console.error('Delete failed:', e);
            Alert.alert('Error', 'Could not delete photo.');
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleSaveDetails = async () => {
    if (!job) return;
    setIsUpdating(true);
    try {
      const contractAmount = parseFloat(String(editForm.contractAmount ?? 0).replace(/[^0-9.]/g, '')) || 0;
      const depositAmount = parseFloat(String(editForm.depositAmount ?? 0).replace(/[^0-9.]/g, '')) || 0;
      const isDepositPaid = job.isDepositPaid;
      const paymentsSum = (job.payments ?? []).reduce((sum, p) => sum + p, 0);
      const balance = contractAmount - (isDepositPaid ? depositAmount : 0) - paymentsSum;

      const updates: Partial<Job> = {
        jobName: editForm.jobName ?? '',
        jobType: editForm.jobType ?? job.jobType,
        trades: editForm.trades ?? job.trades,
        measurements: editForm.measurements ?? '',
        jobDescription: editForm.jobDescription ?? '',
        jobNotes: editForm.jobNotes ?? '',
        contractAmount,
        depositAmount,
        isDepositPaid,
        balance,
        carrier: editForm.carrier ?? '',
        claimNumber: editForm.claimNumber ?? '',
        deductible: parseFloat(String(editForm.deductible ?? 0).replace(/[^0-9.]/g, '')) || 0,
        adjusterName: editForm.adjusterName ?? '',
        adjusterPhone: editForm.adjusterPhone ?? '',
        adjusterEmail: editForm.adjusterEmail ?? '',
        dateOfLoss: editForm.dateOfLoss ?? '',
        dateOfDiscovery: editForm.dateOfDiscovery ?? '',
      };

      await updateDoc(doc(db, 'jobs', id), updates);
      setJob((prev) => prev ? { ...prev, ...updates } : prev);
      setIsEditingDetails(false);
    } catch (e) {
      console.error('Failed to save details:', e);
      Alert.alert('Error', 'Could not save changes.');
    } finally {
      setIsUpdating(false);
    }
  };

  const toggleDepositStatus = async (newValue: boolean) => {
    if (!job || isUpdating) return;
    setIsUpdating(true);
    try {
      const newBalance = job.contractAmount - (newValue ? (job.depositAmount || 0) : 0) - (job.payments || []).reduce((a, b) => a + b, 0);
      await updateDoc(doc(db, 'jobs', id), { isDepositPaid: newValue, balance: newBalance });
      setJob((prev) => prev ? { ...prev, isDepositPaid: newValue, balance: newBalance } : prev);
    } catch (e) {
      console.error('Failed to toggle deposit status:', e);
      Alert.alert('Error', 'Could not update deposit status.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSavePayment = async () => {
    if (!job) return;
    const amount = parseFloat(newPaymentAmount.replace(/[^0-9.]/g, ''));
    if (!amount || amount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment amount.');
      return;
    }
    setIsUpdating(true);
    try {
      const updatedPayments = [...(job.payments ?? []), amount];
      const contractAmount = job.contractAmount ?? 0;
      const depositAmount = job.isDepositPaid ? (job.depositAmount ?? 0) : 0;
      const paymentsSum = updatedPayments.reduce((sum, p) => sum + p, 0);
      const balance = contractAmount - depositAmount - paymentsSum;

      await updateDoc(doc(db, 'jobs', id), { payments: updatedPayments, balance });
      setJob((prev) => prev ? { ...prev, payments: updatedPayments, balance } : prev);
      setNewPaymentAmount('');
      setIsAddingPayment(false);
    } catch (e) {
      console.error('Failed to save payment:', e);
      Alert.alert('Error', 'Could not save payment.');
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2e7d32" />
      </View>
    );
  }

  if (!job) {
    return (
      <View style={styles.centered}>
        <Text style={styles.notFoundText}>Job not found.</Text>
      </View>
    );
  }

  const customerName = customer
    ? `${customer.firstName} ${customer.lastName}`.trim()
    : '—';

  const hasInsurance =
    job.carrier || job.adjusterName || job.adjusterPhone || job.adjusterEmail ||
    job.claimNumber || job.deductible || job.dateOfLoss || job.dateOfDiscovery;

  const currentViewingMedia = viewingMediaIdx !== null ? viewingMediaList[viewingMediaIdx] : null;

  return (
    <>
      <Stack.Screen options={{ title: customerName || job.jobName || job.jobId }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>

        {/* ── Customer Profile (always visible) ── */}
        <Text style={styles.sectionTitle}>Customer</Text>
        <View style={styles.card}>
          <Row label="Name" value={customerName} />
          <Row label="Address" value={customer?.address} />
          {customer?.phone ? <Row label="Phone" value={customer.phone} /> : null}
          {customer?.email ? <Row label="Email" value={customer.email} /> : null}
          {customer?.alternateAddress ? <Row label="Alt. Address" value={customer.alternateAddress} /> : null}
          {customer?.leadSource ? <Row label="Lead Source" value={customer.leadSource} /> : null}
          {customer?.notes ? <Row label="Notes" value={customer.notes} /> : null}
        </View>

        {/* ── Customer's Projects (always visible) ── */}
        {customerJobs.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Customer's Projects</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.projectsRow}
            >
              {customerJobs.map((cj) => {
                const isCurrent = cj.id === id;
                const chipColor = STATUS_COLORS[cj.status] ?? '#999';
                const date = cj.createdAt
                  ? new Date(cj.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                  : '—';
                return (
                  <Pressable
                    key={cj.id}
                    style={[
                      styles.projectPill,
                      isCurrent
                        ? { backgroundColor: chipColor, borderColor: chipColor }
                        : { backgroundColor: '#f0f0f0', borderColor: '#ddd' },
                    ]}
                    onPress={() => { if (!isCurrent) router.setParams({ id: cj.id }); }}
                  >
                    <Text style={[styles.projectPillDate, isCurrent && { color: 'rgba(255,255,255,0.8)' }]}>
                      {date}
                    </Text>
                    <Text style={[styles.projectPillStatus, isCurrent && { color: '#fff' }]}>
                      {cj.status}
                    </Text>
                    {isCurrent && <View style={styles.projectPillCurrentDot} />}
                  </Pressable>
                );
              })}
              <Pressable
                style={[styles.projectPill, styles.projectPillAdd, isCreatingJob && { opacity: 0.5 }]}
                onPress={handleCreateAdditionalJob}
                disabled={isCreatingJob}
              >
                <Text style={styles.projectPillAddText}>
                  {isCreatingJob ? '…' : '➕ Add Job'}
                </Text>
              </Pressable>
            </ScrollView>
          </>
        )}

        {/* ── Job Tab Bar ── */}
        <View style={styles.jobTabRow}>
          <Pressable
            style={[styles.jobTabBtn, activeJobTab === 'details' && styles.jobTabBtnActive]}
            onPress={() => setActiveJobTab('details')}
          >
            <Text style={[styles.jobTabBtnText, activeJobTab === 'details' && styles.jobTabBtnTextActive]}>
              Job Details
            </Text>
          </Pressable>
          <Pressable
            style={[styles.jobTabBtn, activeJobTab === 'media' && styles.jobTabBtnActive]}
            onPress={() => setActiveJobTab('media')}
          >
            <Text style={[styles.jobTabBtnText, activeJobTab === 'media' && styles.jobTabBtnTextActive]}>
              Media & Docs
            </Text>
          </Pressable>
        </View>

        {/* ── Details Tab ── */}
        {activeJobTab === 'details' && (
          <>
            {/* Pipeline Status */}
            <Text style={styles.sectionTitle}>Pipeline Status</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pipelineRow}
            >
              {STATUSES.map((s) => {
                const isActive = job.status === s;
                const color = STATUS_COLORS[s] ?? '#999';
                return (
                  <Pressable
                    key={s}
                    style={[
                      styles.pipelineChip,
                      isActive
                        ? { backgroundColor: color, borderColor: color }
                        : { backgroundColor: '#f0f0f0', borderColor: '#ddd' },
                      isUpdating && styles.pipelineChipDisabled,
                    ]}
                    onPress={() => updateJobStatus(s)}
                    disabled={isUpdating}
                  >
                    <Text
                      style={[
                        styles.pipelineChipText,
                        isActive ? styles.pipelineChipTextActive : styles.pipelineChipTextInactive,
                      ]}
                    >
                      {s}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Job Details */}
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Job Details</Text>
              <TouchableOpacity
                style={styles.sectionActionBtn}
                onPress={() => { setEditForm({ ...job }); setIsEditingDetails(true); }}
              >
                <Text style={styles.sectionActionText}>✏️ Edit Details</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.card}>
              <Row label="Job ID" value={job.jobId} mono />
              {job.jobName ? <Row label="Job Name" value={job.jobName} /> : null}
              <Row label="Job Type" value={job.jobType} />
              <Row label="Trades" value={job.trades?.join(', ') || '—'} />
              {job.measurements ? <Row label="Measurements" value={job.measurements} /> : null}
              {job.jobDescription ? <Row label="Description" value={job.jobDescription} /> : null}
              {job.jobNotes ? <Row label="Job Notes" value={job.jobNotes} /> : null}
            </View>

            {/* Financials */}
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Financials</Text>
              <TouchableOpacity
                style={styles.sectionActionBtn}
                onPress={() => setIsAddingPayment(true)}
              >
                <Text style={styles.sectionActionText}>➕ Add Payment</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.card}>
              <Row label="Contract" value={`$${job.contractAmount?.toFixed(2) ?? '0.00'}`} />
              <View style={[rowStyles.container, { alignItems: 'center' }]}>
                <Text style={rowStyles.label}>
                  Deposit (${job.depositAmount?.toFixed(2) ?? '0.00'})
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: job.isDepositPaid ? '#2e7d32' : '#c62828' }}>
                    {job.isDepositPaid ? 'Paid' : 'Unpaid'}
                  </Text>
                  <Switch
                    value={!!job.isDepositPaid}
                    onValueChange={toggleDepositStatus}
                    disabled={isUpdating}
                    trackColor={{ false: '#ccc', true: '#81c784' }}
                    thumbColor={job.isDepositPaid ? '#2e7d32' : '#f4f3f4'}
                  />
                </View>
              </View>
              {job.payments?.length > 0 && (
                <>
                  {job.payments.map((p, i) => (
                    <Row key={i} label={`Payment ${i + 1}`} value={`$${p.toFixed(2)}`} />
                  ))}
                </>
              )}
              <View style={styles.divider} />
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>Balance</Text>
                <Text style={[styles.balanceValue, (job.balance ?? 0) < 0 && styles.balanceNegative]}>
                  ${job.balance?.toFixed(2) ?? '0.00'}
                </Text>
              </View>
            </View>

            {/* Insurance Details */}
            {hasInsurance ? (
              <>
                <Text style={styles.sectionTitle}>Insurance Details</Text>
                <View style={styles.card}>
                  {job.carrier ? <Row label="Carrier" value={job.carrier} /> : null}
                  {job.claimNumber ? <Row label="Claim #" value={job.claimNumber} /> : null}
                  {job.deductible ? <Row label="Deductible" value={`$${job.deductible.toFixed(2)}`} /> : null}
                  {job.adjusterName ? <Row label="Adjuster" value={job.adjusterName} /> : null}
                  {job.adjusterPhone ? <Row label="Adj. Phone" value={job.adjusterPhone} /> : null}
                  {job.adjusterEmail ? <Row label="Adj. Email" value={job.adjusterEmail} /> : null}
                  {job.dateOfLoss ? <Row label="Date of Loss" value={job.dateOfLoss} /> : null}
                  {job.dateOfDiscovery ? <Row label="Date of Discovery" value={job.dateOfDiscovery} /> : null}
                </View>
              </>
            ) : null}
          </>
        )}

        {/* ── Media Tab ── */}
        {activeJobTab === 'media' && (
          <>
            {FILE_SECTIONS.map(({ type: sectionType, label }) => {
              const isDoc = sectionType === 'document';
              const photoField = sectionType === 'inspection' ? 'inspectionPhotos' : 'installPhotos';
              const photos: JobMedia[] = isDoc
                ? []
                : ((job as any)?.[photoField] ?? []).filter(
                    (p: any) => p && typeof p === 'object' && typeof p.id === 'string',
                  );
              const docFiles = isDoc
                ? ((job.files ?? []).filter((f: any) => f.type === 'document') as JobFile[])
                : [];

              return (
                <View key={sectionType}>
                  <Text style={styles.sectionTitle}>{label}</Text>

                  {isDoc ? (
                    <>
                      <TouchableOpacity
                        style={[styles.docButton, isUploading && styles.photoButtonDisabled]}
                        onPress={handleAddDocument}
                        disabled={isUploading}
                      >
                        <Text style={styles.docButtonText}>
                          {isUploading ? 'Uploading...' : '📄  Add Document'}
                        </Text>
                      </TouchableOpacity>
                      {docFiles.length > 0 ? (
                        <View style={styles.photoGrid}>
                          {docFiles.map((f) => (
                            <View key={f.id} style={styles.photoThumbWrapper}>
                              <TouchableOpacity
                                onPress={() => Linking.openURL(f.url)}
                                onLongPress={() => openFileModal(f)}
                              >
                                <View style={styles.docCard}>
                                  <Text style={styles.docCardIcon}>📄</Text>
                                  <Text style={styles.docCardName} numberOfLines={3}>
                                    {f.name ?? 'Document'}
                                  </Text>
                                  {f.isSharedWithCustomer && (
                                    <View style={styles.docSharedBadge}>
                                      <Text style={styles.sharedBadgeText}>Shared</Text>
                                    </View>
                                  )}
                                </View>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.docDownloadBtn}
                                onPress={() => handleDownloadMedia(f.url, f.name ?? `document_${f.id}`)}
                              >
                                <Text style={styles.docDownloadBtnText}>⬇  Download</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.emptyFiles}>No documents yet.</Text>
                      )}
                    </>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={[styles.photoButton, isUploading && styles.photoButtonDisabled]}
                        onPress={() => handleAddPhoto(photoField as 'inspectionPhotos' | 'installPhotos')}
                        disabled={isUploading}
                      >
                        <Text style={styles.photoButtonText}>
                          {isUploading ? 'Uploading...' : '📷  Add Photo'}
                        </Text>
                      </TouchableOpacity>
                      {photos.length > 0 ? (
                        <>
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={{ gap: 10, marginTop: 10 }}
                          >
                            {photos.map((photo, i) => (
                              <Pressable
                                key={photo.id}
                                onPress={() => {
                                  setViewingMediaList(photos);
                                  setViewingMediaIdx(i);
                                }}
                                onLongPress={() => handleDeletePhoto(photo)}
                              >
                                <View>
                                  <Image source={{ uri: photo.url }} style={styles.photoHThumb} />
                                  {photo.shared && (
                                    <View style={styles.sharedBadge}>
                                      <Text style={styles.sharedBadgeText}>Shared</Text>
                                    </View>
                                  )}
                                </View>
                              </Pressable>
                            ))}
                          </ScrollView>
                          <Text style={styles.photoHint}>Tap to view  ·  Long press to delete</Text>
                        </>
                      ) : (
                        <Text style={styles.emptyFiles}>No {label.toLowerCase()} yet.</Text>
                      )}
                    </>
                  )}
                </View>
              );
            })}
          </>
        )}

      </ScrollView>

      {/* ── Full-Screen Photo Viewer ── */}
      <Modal
        visible={viewingMediaIdx !== null}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setViewingMediaIdx(null)}
      >
        <View style={styles.viewerContainer}>

          <View style={styles.viewerHeader}>
            <TouchableOpacity onPress={() => setViewingMediaIdx(null)} hitSlop={12} style={styles.viewerHeaderBtn}>
              <Text style={styles.viewerClose}>✕  Close</Text>
            </TouchableOpacity>
            <Text style={styles.viewerCounter}>
              {viewingMediaIdx !== null ? `${viewingMediaIdx + 1} / ${viewingMediaList.length}` : ''}
            </Text>
            <TouchableOpacity
              onPress={() => { if (currentViewingMedia) openMediaModal(currentViewingMedia); }}
              hitSlop={12}
              style={styles.viewerHeaderBtn}
            >
              <Text style={styles.viewerEdit}>Edit</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={viewingMediaList}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={viewingMediaIdx ?? 0}
            getItemLayout={(_, index) => ({
              length: SCREEN_WIDTH,
              offset: SCREEN_WIDTH * index,
              index,
            })}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            keyExtractor={(item) => item.id}
            style={styles.viewerFlatList}
            renderItem={({ item }) => (
              <ScrollView
                style={{ width: SCREEN_WIDTH }}
                contentContainerStyle={styles.viewerImageContainer}
                maximumZoomScale={5}
                minimumZoomScale={1}
                centerContent
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
              >
                <Image
                  source={{ uri: item.url }}
                  style={{ width: SCREEN_WIDTH, height: VIEWER_PHOTO_HEIGHT }}
                  resizeMode="contain"
                />
              </ScrollView>
            )}
          />

          <View style={styles.viewerFooter}>
            {currentViewingMedia?.shared && (
              <View style={styles.viewerSharedBadge}>
                <Text style={styles.viewerSharedText}>Shared with Customer</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.downloadBtn}
              onPress={() => { if (currentViewingMedia) handleDownloadMedia(currentViewingMedia.url, `photo_${currentViewingMedia.id}.jpg`); }}
            >
              <Text style={styles.downloadBtnText}>⬇  Download to Phone</Text>
            </TouchableOpacity>
          </View>

        </View>
      </Modal>

      {/* ── Media Edit Modal ── */}
      <Modal
        visible={!!selectedMedia}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedMedia(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSelectedMedia(null)}
        >
          <TouchableOpacity style={styles.fileModalSheet} activeOpacity={1} onPress={() => {}}>

            <View style={styles.fileModalHeader}>
              <Text style={styles.fileModalTitle}>Edit Photo</Text>
              <TouchableOpacity onPress={() => setSelectedMedia(null)} hitSlop={12}>
                <Text style={styles.fileModalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Share with Customer</Text>
              <Switch
                value={editingMediaShared}
                onValueChange={setEditingMediaShared}
                trackColor={{ false: '#ccc', true: '#81c784' }}
                thumbColor={editingMediaShared ? '#2e7d32' : '#f4f3f4'}
              />
            </View>

            <View style={styles.fileModalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setSelectedMedia(null)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveFileBtn} onPress={handleUpdateMedia}>
                <Text style={styles.saveFileBtnText}>Save</Text>
              </TouchableOpacity>
            </View>

          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── File Edit Modal ── */}
      <Modal
        visible={!!selectedFile}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedFile(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSelectedFile(null)}
        >
          <TouchableOpacity style={styles.fileModalSheet} activeOpacity={1} onPress={() => {}}>

            <View style={styles.fileModalHeader}>
              <Text style={styles.fileModalTitle}>Edit File</Text>
              <TouchableOpacity onPress={() => setSelectedFile(null)} hitSlop={12}>
                <Text style={styles.fileModalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.fileModalLabel}>Category</Text>
            <View style={styles.catChipRow}>
              {FILE_SECTIONS.map(({ type: t, label }) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.catChip, editingType === t && styles.catChipActive]}
                  onPress={() => setEditingType(t)}
                >
                  <Text style={[styles.catChipText, editingType === t && styles.catChipTextActive]}>
                    {label.replace(' Photos', '')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Share with Customer</Text>
              <Switch
                value={editingShared}
                onValueChange={setEditingShared}
                trackColor={{ false: '#ccc', true: '#81c784' }}
                thumbColor={editingShared ? '#2e7d32' : '#f4f3f4'}
              />
            </View>

            <View style={styles.fileModalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setSelectedFile(null)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveFileBtn} onPress={handleUpdateFile}>
                <Text style={styles.saveFileBtnText}>Save</Text>
              </TouchableOpacity>
            </View>

          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Edit Details Modal ── */}
      <Modal
        visible={isEditingDetails}
        animationType="slide"
        transparent
        onRequestClose={() => setIsEditingDetails(false)}
      >
        <View style={styles.editModalOverlay}>
          <View style={styles.editModalSheet}>

            <View style={styles.editModalHeader}>
              <TouchableOpacity onPress={() => setIsEditingDetails(false)}>
                <Text style={styles.editModalCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.editModalTitle}>Edit Details</Text>
              <TouchableOpacity onPress={handleSaveDetails} disabled={isUpdating}>
                <Text style={[styles.editModalSave, isUpdating && styles.editModalSaveDisabled]}>
                  {isUpdating ? 'Saving…' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.editModalScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {/* ── Job ── */}
              <Text style={styles.editSectionLabel}>Job</Text>

              <Text style={styles.inputLabel}>Job Name</Text>
              <TextInput
                style={styles.textInput}
                value={editForm.jobName ?? ''}
                onChangeText={(t) => setEditForm((p) => ({ ...p, jobName: t }))}
                placeholder="Job name"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.inputLabel}>Job Type</Text>
              <View style={styles.chipRow}>
                {(['Retail', 'Insurance'] as const).map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.typeChip, editForm.jobType === type && styles.typeChipActive]}
                    onPress={() => setEditForm((p) => ({ ...p, jobType: type }))}
                  >
                    <Text style={[styles.typeChipText, editForm.jobType === type && styles.typeChipTextActive]}>
                      {type}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>Trades</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {AVAILABLE_TRADES.map((trade) => {
                  const isActive = editForm?.trades?.includes(trade);
                  return (
                    <TouchableOpacity
                      key={trade}
                      style={[styles.typeChip, isActive && styles.typeChipActive]}
                      onPress={() =>
                        setEditForm((p) => {
                          const current = p.trades ?? [];
                          return {
                            ...p,
                            trades: current.includes(trade)
                              ? current.filter((t) => t !== trade)
                              : [...current, trade],
                          };
                        })
                      }
                    >
                      <Text style={[styles.typeChipText, isActive && styles.typeChipTextActive]}>
                        {trade}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.inputLabel}>Measurements</Text>
              <TextInput
                style={styles.textInput}
                value={editForm.measurements ?? ''}
                onChangeText={(t) => setEditForm((p) => ({ ...p, measurements: t }))}
                placeholder="Square footage, etc."
                placeholderTextColor="#aaa"
              />

              <Text style={styles.inputLabel}>Description</Text>
              <TextInput
                style={[styles.textInput, styles.textInputMultiline]}
                value={editForm.jobDescription ?? ''}
                onChangeText={(t) => setEditForm((p) => ({ ...p, jobDescription: t }))}
                placeholder="Job description"
                placeholderTextColor="#aaa"
                multiline
                numberOfLines={3}
              />

              <Text style={styles.inputLabel}>Job Notes</Text>
              <TextInput
                style={[styles.textInput, styles.textInputMultiline]}
                value={editForm.jobNotes ?? ''}
                onChangeText={(t) => setEditForm((p) => ({ ...p, jobNotes: t }))}
                placeholder="Internal notes"
                placeholderTextColor="#aaa"
                multiline
                numberOfLines={3}
              />

              {/* ── Financials ── */}
              <Text style={styles.editSectionLabel}>Financials</Text>

              <Text style={styles.inputLabel}>Contract Amount ($)</Text>
              <TextInput
                style={styles.textInput}
                value={editForm.contractAmount != null ? String(editForm.contractAmount) : ''}
                onChangeText={(t) =>
                  setEditForm((p) => ({ ...p, contractAmount: parseFloat(t.replace(/[^0-9.]/g, '')) || 0 }))
                }
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.inputLabel}>Deposit Amount ($)</Text>
              <TextInput
                style={styles.textInput}
                value={editForm.depositAmount != null ? String(editForm.depositAmount) : ''}
                onChangeText={(t) =>
                  setEditForm((p) => ({ ...p, depositAmount: parseFloat(t.replace(/[^0-9.]/g, '')) || 0 }))
                }
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#aaa"
              />

              {/* ── Insurance ── */}
              <Text style={styles.editSectionLabel}>Insurance</Text>

              <Text style={styles.inputLabel}>Carrier</Text>
              <TextInput
                style={styles.textInput}
                value={editForm.carrier ?? ''}
                onChangeText={(t) => setEditForm((p) => ({ ...p, carrier: t }))}
                placeholder="Insurance carrier"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.inputLabel}>Claim #</Text>
              <TextInput
                style={styles.textInput}
                value={editForm.claimNumber ?? ''}
                onChangeText={(t) => setEditForm((p) => ({ ...p, claimNumber: t }))}
                placeholder="Claim number"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.inputLabel}>Deductible ($)</Text>
              <TextInput
                style={styles.textInput}
                value={editForm.deductible ? String(editForm.deductible) : ''}
                onChangeText={(t) =>
                  setEditForm((p) => ({ ...p, deductible: parseFloat(t.replace(/[^0-9.]/g, '')) || 0 }))
                }
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.inputLabel}>Adjuster Name</Text>
              <TextInput
                style={styles.textInput}
                value={editForm.adjusterName ?? ''}
                onChangeText={(t) => setEditForm((p) => ({ ...p, adjusterName: t }))}
                placeholder="Adjuster full name"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.inputLabel}>Adjuster Phone</Text>
              <TextInput
                style={styles.textInput}
                value={editForm.adjusterPhone ?? ''}
                onChangeText={(t) => setEditForm((p) => ({ ...p, adjusterPhone: t }))}
                keyboardType="phone-pad"
                placeholder="Phone number"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.inputLabel}>Adjuster Email</Text>
              <TextInput
                style={styles.textInput}
                value={editForm.adjusterEmail ?? ''}
                onChangeText={(t) => setEditForm((p) => ({ ...p, adjusterEmail: t }))}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="Email address"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.inputLabel}>Date of Loss</Text>
              <TextInput
                style={styles.textInput}
                value={editForm.dateOfLoss ?? ''}
                onChangeText={(t) => setEditForm((p) => ({ ...p, dateOfLoss: t }))}
                placeholder="e.g. 2024-01-15"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.inputLabel}>Date of Discovery</Text>
              <TextInput
                style={styles.textInput}
                value={editForm.dateOfDiscovery ?? ''}
                onChangeText={(t) => setEditForm((p) => ({ ...p, dateOfDiscovery: t }))}
                placeholder="e.g. 2024-01-20"
                placeholderTextColor="#aaa"
              />

              <View style={{ height: 40 }} />
            </ScrollView>

          </View>
        </View>
      </Modal>

      {/* ── Add Payment Modal ── */}
      <Modal
        visible={isAddingPayment}
        transparent
        animationType="fade"
        onRequestClose={() => { setIsAddingPayment(false); setNewPaymentAmount(''); }}
      >
        <View style={styles.paymentModalOverlay}>
          <View style={styles.paymentModalCard}>
            <Text style={styles.paymentModalTitle}>Add Payment</Text>
            <Text style={styles.inputLabel}>Amount ($)</Text>
            <TextInput
              style={styles.textInput}
              value={newPaymentAmount}
              onChangeText={setNewPaymentAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="#aaa"
              autoFocus
            />
            <View style={styles.fileModalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => { setIsAddingPayment(false); setNewPaymentAmount(''); }}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveFileBtn, isUpdating && styles.photoButtonDisabled]}
                onPress={handleSavePayment}
                disabled={isUpdating}
              >
                <Text style={styles.saveFileBtnText}>
                  {isUpdating ? 'Saving…' : 'Save Payment'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ── Reusable row component ──────────────────────────────────
function Row({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <View style={rowStyles.container}>
      <Text style={rowStyles.label}>{label}</Text>
      <Text style={[rowStyles.value, mono && rowStyles.mono]} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#777',
    flex: 1,
  },
  value: {
    fontSize: 14,
    color: '#1a1a1a',
    flex: 2,
    textAlign: 'right',
  },
  mono: {
    fontFamily: 'monospace' as any,
    fontSize: 12,
    color: '#555',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scroll: {
    padding: 20,
    paddingBottom: 48,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notFoundText: {
    fontSize: 16,
    color: '#999',
  },

  // Status banner
  statusBanner: {
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 16,
  },
  statusBannerText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.5,
  },

  // Sections
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 6,
  },
  sectionActionBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  sectionActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2e7d32',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },

  // Pipeline status chips
  pipelineRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  pipelineChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  pipelineChipDisabled: {
    opacity: 0.5,
  },
  pipelineChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  pipelineChipTextActive: {
    color: '#fff',
  },
  pipelineChipTextInactive: {
    color: '#555',
  },

  // Photo / file sections
  photoButton: {
    backgroundColor: '#1976d2',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  photoButtonDisabled: {
    opacity: 0.5,
  },
  photoButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  photoThumbWrapper: {
    position: 'relative',
  },
  photoThumb: {
    width: 100,
    height: 100,
    borderRadius: 8,
    backgroundColor: '#e0e0e0',
  },
  sharedBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(46,125,50,0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  sharedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  emptyFiles: {
    fontSize: 13,
    color: '#bbb',
    fontStyle: 'italic',
    marginTop: 6,
  },

  // Document upload button
  docButton: {
    backgroundColor: '#1565c0',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  docButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },

  // Document grid card
  docCard: {
    width: 100,
    height: 100,
    borderRadius: 8,
    backgroundColor: '#e3f2fd',
    borderWidth: 1,
    borderColor: '#90caf9',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    gap: 4,
  },
  docCardIcon: {
    fontSize: 28,
  },
  docCardName: {
    fontSize: 10,
    fontWeight: '600',
    color: '#1565c0',
    textAlign: 'center',
  },
  docSharedBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(46,125,50,0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  docDownloadBtn: {
    backgroundColor: '#e3f2fd',
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
    alignItems: 'center',
    marginTop: 4,
    width: 100,
  },
  docDownloadBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1565c0',
  },

  // Financials
  divider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 8,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  balanceLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  balanceValue: {
    fontSize: 17,
    fontWeight: '800',
    color: '#2e7d32',
  },
  balanceNegative: {
    color: '#c62828',
  },

  // ── Full-Screen Viewer ──
  viewerContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  viewerHeaderBtn: {
    minWidth: 64,
  },
  viewerClose: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  viewerCounter: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
  },
  viewerEdit: {
    fontSize: 16,
    fontWeight: '700',
    color: '#81c784',
    textAlign: 'right',
  },
  viewerFlatList: {
    flex: 1,
  },
  viewerImageContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  viewerFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
    backgroundColor: 'rgba(0,0,0,0.6)',
    gap: 10,
  },
  viewerSharedBadge: {
    alignSelf: 'center',
    backgroundColor: 'rgba(46,125,50,0.85)',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 12,
  },
  viewerSharedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  downloadBtn: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  downloadBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },

  // ── File Edit Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  fileModalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    gap: 14,
  },
  fileModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fileModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  fileModalClose: {
    fontSize: 18,
    fontWeight: '600',
    color: '#555',
  },
  fileModalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  catChipRow: {
    flexDirection: 'row',
    gap: 10,
  },
  catChip: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#ddd',
    backgroundColor: '#f5f5f5',
  },
  catChipActive: {
    backgroundColor: '#2e7d32',
    borderColor: '#2e7d32',
  },
  catChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555',
  },
  catChipTextActive: {
    color: '#fff',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginTop: 12,
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  fileModalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#555',
  },
  saveFileBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#2e7d32',
    alignItems: 'center',
  },
  saveFileBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },

  // ── Edit Details Modal ──
  editModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  editModalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '92%',
  },
  editModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  editModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  editModalCancel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#555',
    minWidth: 60,
  },
  editModalSave: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2e7d32',
    minWidth: 60,
    textAlign: 'right',
  },
  editModalSaveDisabled: {
    opacity: 0.4,
  },
  editModalScroll: {
    paddingHorizontal: 20,
  },
  editSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 24,
    marginBottom: 4,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
    marginTop: 14,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#f9f9f9',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1a1a1a',
  },
  textInputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  typeChip: {
    paddingVertical: 9,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#ddd',
    backgroundColor: '#f5f5f5',
  },
  typeChipActive: {
    backgroundColor: '#2e7d32',
    borderColor: '#2e7d32',
  },
  typeChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555',
  },
  typeChipTextActive: {
    color: '#fff',
  },

  // ── Customer's Projects ──
  projectsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  projectPill: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    minWidth: 80,
    gap: 2,
  },
  projectPillDate: {
    fontSize: 10,
    fontWeight: '600',
    color: '#888',
  },
  projectPillStatus: {
    fontSize: 12,
    fontWeight: '700',
    color: '#333',
  },
  projectPillCurrentDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  projectPillAdd: {
    backgroundColor: '#f0f0f0',
    borderColor: '#bbb',
    borderStyle: 'dashed',
    justifyContent: 'center',
  },
  projectPillAddText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#555',
  },

  // ── Job Tabs ──
  jobTabRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    marginBottom: 4,
  },
  jobTabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#ebebeb',
  },
  jobTabBtnActive: {
    backgroundColor: '#1976d2',
  },
  jobTabBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#777',
  },
  jobTabBtnTextActive: {
    color: '#fff',
  },

  // ── Add Payment Modal ──
  paymentModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  paymentModalCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    gap: 4,
  },
  paymentModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 8,
  },

  // ── Horizontal photo strip ──
  photoHScroll: {
    marginTop: 10,
    marginBottom: 6,
  },
  photoHThumb: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  photoHint: {
    fontSize: 11,
    color: '#bbb',
    fontStyle: 'italic',
    marginTop: 6,
  },
});
