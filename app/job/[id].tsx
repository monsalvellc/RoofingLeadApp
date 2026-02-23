import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { arrayUnion, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import { db, storage } from '../../config/firebaseConfig';
import { Customer, Job } from '../../types';

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

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [job, setJob] = useState<Job | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

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

  const handleAddPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Camera access is needed to take inspection photos.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      if (result.canceled) return;

      setIsUploading(true);

      // React Native blob workaround
      const response = await fetch(result.assets[0].uri);
      const blob = await response.blob();

      const imageRef = ref(storage, `jobs/${id}/${Date.now()}.jpg`);
      await uploadBytes(imageRef, blob);
      const downloadUrl = await getDownloadURL(imageRef);

      const newFile = {
        id: Date.now().toString(),
        url: downloadUrl,
        type: 'inspection' as const,
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

        {/* ── Inspection Photos ── */}
        <Text style={styles.sectionTitle}>Inspection Photos</Text>
        <TouchableOpacity
          style={[styles.photoButton, isUploading && styles.photoButtonDisabled]}
          onPress={handleAddPhoto}
          disabled={isUploading}
        >
          <Text style={styles.photoButtonText}>
            {isUploading ? 'Uploading...' : '📷  Add Photo'}
          </Text>
        </TouchableOpacity>

        {(job.files?.filter((f: any) => f.type === 'inspection').length ?? 0) > 0 && (
          <View style={styles.photoGrid}>
            {job.files!.filter((f: any) => f.type === 'inspection').map((f: any) => (
              <Image key={f.id} source={{ uri: f.url }} style={styles.photoThumb} />
            ))}
          </View>
        )}

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

  // Inspection Photos
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
  photoThumb: {
    width: 100,
    height: 100,
    borderRadius: 8,
    backgroundColor: '#e0e0e0',
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
});
