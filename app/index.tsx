import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../config/firebaseConfig';
import { Job } from '../types';
import { useAuth } from '../context/AuthContext';

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

const STATUS_FILTERS: Job['status'][] = [
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

const TYPE_FILTERS: Job['jobType'][] = ['Retail', 'Insurance'];

export default function DashboardScreen() {
  const router = useRouter();
  const { userProfile, logout } = useAuth();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<Job[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Job['status'] | null>(null);
  const [typeFilter, setTypeFilter] = useState<Job['jobType'] | null>(null);
  const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);

  // Pending selections — staged inside modal, committed on "Apply"
  const [pendingStatus, setPendingStatus] = useState<Job['status'] | null>(null);
  const [pendingType, setPendingType] = useState<Job['jobType'] | null>(null);

  console.log('DASHBOARD RENDER - Current Company ID:', userProfile?.companyId);

  // Firebase listener — master list
  useEffect(() => {
    if (!userProfile?.companyId) return;
    const q = query(
      collection(db, 'jobs'),
      where('companyId', '==', userProfile?.companyId),
      orderBy('createdAt', 'desc'),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        console.log(`FIREBASE RETURNED ${snapshot.docs.length} JOBS`);
        const data = snapshot.docs.map((d) => ({
          ...d.data(),
          id: d.id,
        })) as Job[];
        setJobs(data);
      },
      (error) => {
        console.error('FIREBASE DASHBOARD ERROR:', error);
      },
    );
    return unsubscribe;
  }, [userProfile?.companyId]);

  // Client-side filter effect
  useEffect(() => {
    let result = jobs;

    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.trim().toLowerCase();
      const numericQuery = searchQuery.replace(/\D/g, '');
      result = result.filter((job) => {
        const name = (job.customerName || '').toLowerCase();
        const address = ((job as any).customerAddress || '').toLowerCase();
        const altAddress = ((job as any).customerAlternateAddress || '').toLowerCase();
        const phone = (job.customerPhone || '').replace(/\D/g, '');
        const jName = (job.jobName || '').toLowerCase();
        const jId = (job.jobId || '').toLowerCase();

        if (name.includes(lowerQuery)) return true;
        if (address.includes(lowerQuery)) return true;
        if (altAddress.includes(lowerQuery)) return true;
        if (jName.includes(lowerQuery)) return true;
        if (jId.includes(lowerQuery)) return true;
        if (numericQuery.length > 0 && phone.includes(numericQuery)) return true;
        return false;
      });
    }

    if (statusFilter) {
      result = result.filter((job) => job.status === statusFilter);
    }

    if (typeFilter) {
      result = result.filter((job) => job.jobType === typeFilter);
    }

    setFilteredJobs(result);
  }, [jobs, searchQuery, statusFilter, typeFilter]);

  const openFilterModal = () => {
    setPendingStatus(statusFilter);
    setPendingType(typeFilter);
    setIsFilterModalVisible(true);
  };

  const applyFilters = () => {
    setStatusFilter(pendingStatus);
    setTypeFilter(pendingType);
    setIsFilterModalVisible(false);
  };

  const clearFilters = () => {
    setPendingStatus(null);
    setPendingType(null);
    setStatusFilter(null);
    setTypeFilter(null);
    setIsFilterModalVisible(false);
  };

  const migrateAddresses = async () => {
    Alert.alert(
      'Migrate Addresses?',
      'Copies customer address fields onto Job documents for all existing leads.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Migrate',
          onPress: async () => {
            try {
              const snapshot = await getDocs(collection(db, 'jobs'));
              let count = 0;
              const updates: Promise<void>[] = [];
              for (const jobSnap of snapshot.docs) {
                const data = jobSnap.data();
                if (!data.customerAddress && data.customerId) {
                  const custSnap = await getDoc(doc(db, 'customers', data.customerId));
                  if (custSnap.exists()) {
                    const custData = custSnap.data();
                    updates.push(
                      updateDoc(doc(db, 'jobs', jobSnap.id), {
                        customerAddress: custData.address || '',
                        customerAlternateAddress: custData.alternateAddress || '',
                      }),
                    );
                    count++;
                  }
                }
              }
              await Promise.all(updates);
              Alert.alert('Done', `Migrated ${count} job(s).`);
            } catch (e: any) {
              Alert.alert('Migration Failed', e.message);
            }
          },
        },
      ],
    );
  };

  const handleDelete = (jobDocId: string) => {
    Alert.alert('Delete Job?', 'This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteDoc(doc(db, 'jobs', jobDocId)),
      },
    ]);
  };

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getFinancialColor = (job: Job): string => {
    if (!job.contractAmount) return 'gray';
    if (job.balance === 0) return '#2e7d32';
    if (job.status === 'Completed' && job.balance > 0 && job.completedAt) {
      const days = (new Date().getTime() - new Date(job.completedAt).getTime()) / (1000 * 3600 * 24);
      if (days > 5) return '#FF5F1F';
    }
    if (job.balance > 0) return '#c62828';
    return 'gray';
  };

  const isFiltering = !!searchQuery.trim() || !!statusFilter || !!typeFilter;
  const activeFilterCount = (statusFilter ? 1 : 0) + (typeFilter ? 1 : 0);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>Welcome, {userProfile?.firstName || 'User'}</Text>
        <Text style={styles.subtitle}>
          {isFiltering ? `${filteredJobs.length} of ${jobs.length}` : jobs.length} Jobs
        </Text>
      </View>

      {/* Temp Sign Out */}
      <Button title="Sign Out" onPress={logout} color="red" />

      {/* Search bar + Filter button row */}
      <View style={styles.searchRow}>
        <View style={styles.searchInputWrapper}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search name, phone, address..."
            placeholderTextColor="#aaa"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity style={styles.filterButton} onPress={openFilterModal}>
          <Ionicons name="filter" size={20} color="white" />
          {activeFilterCount > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Active filter summary pills */}
      {(statusFilter || typeFilter) && (
        <View style={styles.activeSummary}>
          {statusFilter && (
            <View style={[styles.activePill, { backgroundColor: STATUS_COLORS[statusFilter] ?? '#999' }]}>
              <Text style={styles.activePillText}>{statusFilter}</Text>
            </View>
          )}
          {typeFilter && (
            <View style={styles.activePill}>
              <Text style={styles.activePillText}>{typeFilter}</Text>
            </View>
          )}
        </View>
      )}

      {/* Job list */}
      {jobs.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No jobs yet. Tap + to add one.</Text>
        </View>
      ) : filteredJobs.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No jobs match your search.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredJobs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/job/${item.id}`)}
              onLongPress={() => handleDelete(item.id)}
            >
              <View style={styles.cardTop}>
                <Text style={styles.leadName}>{item.customerName || item.jobName}</Text>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: STATUS_COLORS[item.status] ?? '#999' },
                  ]}
                >
                  <Text style={styles.statusText}>{item.status}</Text>
                </View>
              </View>
              <View style={styles.cardBottom}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                  <Text style={{ color: '#666', fontSize: 14 }}>
                    {item.jobType} • Contract:{' '}
                  </Text>
                  <Text style={{ color: getFinancialColor(item), fontWeight: '600', fontSize: 14 }}>
                    ${(item.contractAmount || 0).toFixed(2)}
                  </Text>
                </View>
                <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>
              </View>
            </Pressable>
          )}
          ListFooterComponent={
            <Text style={styles.hint}>Long-press a job to delete</Text>
          }
        />
      )}

      {/* FAB */}
      <Pressable style={styles.fab} onPress={() => router.push('/add-lead')}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      {/* ── Temporary Migration Tool ── */}
      <Button title="MIGRATE ADDRESSES" onPress={migrateAddresses} color="red" />

      {/* ── Filter Modal ── */}
      <Modal
        visible={isFilterModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsFilterModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsFilterModalVisible(false)}
        >
          <TouchableOpacity style={styles.modalSheet} activeOpacity={1} onPress={() => {}}>

            {/* Modal header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Filter & Sort</Text>
              <TouchableOpacity onPress={() => setIsFilterModalVisible(false)} hitSlop={12}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Pipeline Status */}
            <Text style={styles.modalSectionLabel}>Pipeline Status</Text>
            <View style={styles.modalChipWrap}>
              {STATUS_FILTERS.map((s) => {
                const active = pendingStatus === s;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.modalChip,
                      active && { backgroundColor: STATUS_COLORS[s], borderColor: STATUS_COLORS[s] },
                    ]}
                    onPress={() => setPendingStatus(active ? null : s)}
                  >
                    <Text style={[styles.modalChipText, active && styles.modalChipTextActive]}>
                      {s}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Job Type */}
            <Text style={styles.modalSectionLabel}>Job Type</Text>
            <View style={styles.modalChipWrap}>
              {TYPE_FILTERS.map((t) => {
                const active = pendingType === t;
                return (
                  <TouchableOpacity
                    key={t}
                    style={[
                      styles.modalChip,
                      active && styles.modalChipActiveGreen,
                    ]}
                    onPress={() => setPendingType(active ? null : t)}
                  >
                    <Text style={[styles.modalChipText, active && styles.modalChipTextActive]}>
                      {t}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.clearButton} onPress={clearFilters}>
                <Text style={styles.clearButtonText}>Clear All</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.applyButton} onPress={applyFilters}>
                <Text style={styles.applyButtonText}>Apply</Text>
              </TouchableOpacity>
            </View>

          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },

  // Header
  header: {
    backgroundColor: '#2e7d32',
    paddingTop: 60,
    paddingBottom: 24,
    paddingHorizontal: 24,
  },
  greeting: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fff',
  },
  subtitle: {
    fontSize: 15,
    color: '#c8e6c9',
    marginTop: 4,
  },

  // Search row
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    gap: 10,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 15,
    color: '#1a1a1a',
  },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  clearBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#999',
  },
  filterButton: {
    width: 45,
    height: 45,
    borderRadius: 23,
    backgroundColor: '#2e7d32',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonIcon: {
    fontSize: 20,
    color: '#fff',
    lineHeight: 22,
  },
  filterBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FF5F1F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },

  // Active filter summary pills
  activeSummary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  activePill: {
    backgroundColor: '#2e7d32',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  activePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },

  // Empty state
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
  },

  // List
  list: {
    padding: 16,
    gap: 12,
    paddingBottom: 100,
  },

  // Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  leadName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1a1a1a',
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardDate: {
    fontSize: 13,
    color: '#999',
  },

  // Hint
  hint: {
    textAlign: 'center',
    fontSize: 13,
    color: '#bbb',
    marginTop: 8,
    paddingBottom: 16,
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 32,
    right: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#2e7d32',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: {
    fontSize: 32,
    fontWeight: '300',
    color: '#fff',
    marginTop: -2,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  modalCloseText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#555',
  },
  modalSectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: 8,
  },
  modalChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modalChip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#ddd',
    backgroundColor: '#f5f5f5',
  },
  modalChipActiveGreen: {
    backgroundColor: '#2e7d32',
    borderColor: '#2e7d32',
  },
  modalChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
  },
  modalChipTextActive: {
    color: '#fff',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  clearButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  clearButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#555',
  },
  applyButton: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#2e7d32',
    alignItems: 'center',
  },
  applyButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
