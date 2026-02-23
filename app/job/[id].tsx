import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { arrayUnion, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { db, storage } from '../../config/firebaseConfig';
import { Customer, Job, JobFile } from '../../types';

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

const FILE_SECTIONS: { type: JobFile['type']; label: string }[] = [
  { type: 'inspection', label: 'Inspection Photos' },
  { type: 'install', label: 'Install Photos' },
  { type: 'document', label: 'Documents' },
];

// Height available for the photo inside the viewer (screen minus header + footer chrome)
const VIEWER_PHOTO_HEIGHT = SCREEN_HEIGHT - 140;

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

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
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);
  const [filteredPhotos, setFilteredPhotos] = useState<JobFile[]>([]);

  // Stable refs required by FlatList — must not be recreated on render
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0 && viewableItems[0].index !== null) {
      setViewingIndex(viewableItems[0].index);
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
      setViewingIndex(null); // close viewer too — photo may have moved to a different section
    } catch (e) {
      console.error('Failed to update file:', e);
      Alert.alert('Error', 'Could not update file.');
    }
  };

  const handleDownloadPhoto = async (url: string) => {
    const { status } = await MediaLibrary.requestPermissionsAsync(true);
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Photo library access is needed to save photos.');
      return;
    }
    try {
      const fileUri = FileSystem.documentDirectory + 'photo_' + Date.now() + '.jpg';
      const { uri } = await FileSystem.downloadAsync(url, fileUri);
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('Saved!', 'Photo saved to your gallery.');
    } catch (e) {
      console.error('Download failed:', e);
      Alert.alert('Download Failed', 'Could not save photo. Please try again.');
    }
  };

  const handleAddPhoto = async (photoType: JobFile['type'] = 'inspection') => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Camera access is needed to take photos.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      if (result.canceled) return;

      setIsUploading(true);

      const response = await fetch(result.assets[0].uri);
      const blob = await response.blob();

      const imageRef = ref(storage, `jobs/${id}/${Date.now()}.jpg`);
      await uploadBytes(imageRef, blob);
      const downloadUrl = await getDownloadURL(imageRef);

      const newFile: JobFile = {
        id: Date.now().toString(),
        url: downloadUrl,
        type: photoType,
        isSharedWithCustomer: false,
        createdAt: new Date().toISOString(),
      };
      await updateDoc(doc(db, 'jobs', id), { files: arrayUnion(newFile) });
      setJob((prev) => prev ? { ...prev, files: [...(prev.files ?? []), newFile as any] } : prev);
    } catch (e) {
      console.error('Photo upload failed:', e);
      Alert.alert('Upload Failed', 'Could not upload photo. Please try again.');
    } finally {
      setIsUploading(false);
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

  const currentViewingFile = viewingIndex !== null ? filteredPhotos[viewingIndex] : null;

  return (
    <>
      <Stack.Screen options={{ title: customerName || job.jobName || job.jobId }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>

        {/* ── Status Banner ── */}
        <View
          style={[
            styles.statusBanner,
            { backgroundColor: STATUS_COLORS[job.status] ?? '#999' },
          ]}
        >
          <Text style={styles.statusBannerText}>{job.status}</Text>
        </View>

        {/* ── Customer Profile ── */}
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

        {/* ── Pipeline Status ── */}
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

        {/* ── File Sections ── */}
        {FILE_SECTIONS.map(({ type: sectionType, label }) => {
          const sectionFiles = (job.files ?? []).filter((f: any) => f.type === sectionType) as JobFile[];
          const isDoc = sectionType === 'document';
          return (
            <View key={sectionType}>
              <Text style={styles.sectionTitle}>{label}</Text>

              {/* Action button — photo camera or document picker */}
              {isDoc ? (
                <TouchableOpacity
                  style={[styles.docButton, isUploading && styles.photoButtonDisabled]}
                  onPress={handleAddDocument}
                  disabled={isUploading}
                >
                  <Text style={styles.docButtonText}>
                    {isUploading ? 'Uploading...' : '📄  Add Document'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.photoButton, isUploading && styles.photoButtonDisabled]}
                  onPress={() => handleAddPhoto(sectionType)}
                  disabled={isUploading}
                >
                  <Text style={styles.photoButtonText}>
                    {isUploading ? 'Uploading...' : '📷  Add Photo'}
                  </Text>
                </TouchableOpacity>
              )}

              {sectionFiles.length > 0 ? (
                <View style={styles.photoGrid}>
                  {sectionFiles.map((f, index) => (
                    <TouchableOpacity
                      key={f.id}
                      style={styles.photoThumbWrapper}
                      onPress={() => {
                        if (isDoc) {
                          // Documents: tap opens edit modal directly (no viewer)
                          openFileModal(f);
                        } else {
                          // Photos: tap opens full-screen viewer
                          setFilteredPhotos(sectionFiles);
                          setViewingIndex(index);
                        }
                      }}
                    >
                      {isDoc ? (
                        /* Document card — shows icon + filename */
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
                      ) : (
                        /* Photo thumbnail */
                        <>
                          <Image source={{ uri: f.url }} style={styles.photoThumb} />
                          {f.isSharedWithCustomer && (
                            <View style={styles.sharedBadge}>
                              <Text style={styles.sharedBadgeText}>Shared</Text>
                            </View>
                          )}
                        </>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <Text style={styles.emptyFiles}>No {label.toLowerCase()} yet.</Text>
              )}
            </View>
          );
        })}

        {/* ── Job Details ── */}
        <Text style={styles.sectionTitle}>Job Details</Text>
        <View style={styles.card}>
          <Row label="Job ID" value={job.jobId} mono />
          {job.jobName ? <Row label="Job Name" value={job.jobName} /> : null}
          <Row label="Job Type" value={job.jobType} />
          <Row label="Trades" value={job.trades?.join(', ') || '—'} />
          {job.measurements ? <Row label="Measurements" value={job.measurements} /> : null}
          {job.jobDescription ? <Row label="Description" value={job.jobDescription} /> : null}
          {job.jobNotes ? <Row label="Job Notes" value={job.jobNotes} /> : null}
        </View>

        {/* ── Financials ── */}
        <Text style={styles.sectionTitle}>Financials</Text>
        <View style={styles.card}>
          <Row label="Contract" value={`$${job.contractAmount?.toFixed(2) ?? '0.00'}`} />
          <Row
            label="Deposit"
            value={`$${job.depositAmount?.toFixed(2) ?? '0.00'} ${job.isDepositPaid ? '(Paid)' : '(Unpaid)'}`}
          />
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

        {/* ── Insurance Details (conditional) ── */}
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

      </ScrollView>

      {/* ── Full-Screen Photo Viewer ── */}
      <Modal
        visible={viewingIndex !== null}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setViewingIndex(null)}
      >
        <View style={styles.viewerContainer}>

          {/* Viewer header */}
          <View style={styles.viewerHeader}>
            <TouchableOpacity onPress={() => setViewingIndex(null)} hitSlop={12} style={styles.viewerHeaderBtn}>
              <Text style={styles.viewerClose}>✕  Close</Text>
            </TouchableOpacity>
            <Text style={styles.viewerCounter}>
              {viewingIndex !== null ? `${viewingIndex + 1} / ${filteredPhotos.length}` : ''}
            </Text>
            <TouchableOpacity
              onPress={() => { if (currentViewingFile) openFileModal(currentViewingFile); }}
              hitSlop={12}
              style={styles.viewerHeaderBtn}
            >
              <Text style={styles.viewerEdit}>Edit</Text>
            </TouchableOpacity>
          </View>

          {/* Swipeable photo pager */}
          <FlatList
            data={filteredPhotos}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={viewingIndex ?? 0}
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

          {/* Viewer footer */}
          <View style={styles.viewerFooter}>
            {currentViewingFile?.isSharedWithCustomer && (
              <View style={styles.viewerSharedBadge}>
                <Text style={styles.viewerSharedText}>Shared with Customer</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.downloadBtn}
              onPress={() => { if (currentViewingFile) handleDownloadPhoto(currentViewingFile.url); }}
            >
              <Text style={styles.downloadBtnText}>⬇  Download to Phone</Text>
            </TouchableOpacity>
          </View>

        </View>
      </Modal>

      {/* ── File Edit Modal (slides up over the viewer) ── */}
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
    marginBottom: 6,
    marginTop: 20,
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
    whiteSpace: 'nowrap' as any,
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

  // Document upload button (blue variant of photoButton)
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
    paddingTop: 56, // safe area buffer
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
});
