import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { arrayUnion, collection, doc, getDocs, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { Ionicons } from '@expo/vector-icons';
import { db } from '../../config/firebaseConfig';
import { useAuth } from '../../context/AuthContext';

export default function CustomerProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { userProfile } = useAuth();

  const [customer, setCustomer] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAssignModalVisible, setIsAssignModalVisible] = useState(false);
  const [companyUsers, setCompanyUsers] = useState<{ id: string; name: string }[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (!id) return;
    const unsubscribe = onSnapshot(
      doc(db, 'customers', id),
      (snap) => {
        if (snap.exists()) {
          setCustomer({ id: snap.id, ...snap.data() });
        } else {
          setCustomer(null);
        }
        setLoading(false);
      },
      (error) => {
        console.error('CUSTOMER PROFILE SNAPSHOT ERROR:', error);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [id]);

  const fetchCompanyUsers = async () => {
    if (!userProfile?.companyId) return;
    try {
      const q = query(collection(db, 'users'), where('companyId', '==', userProfile.companyId));
      const snap = await getDocs(q);
      const users = snap.docs.map((d) => ({
        id: d.id,
        name: `${d.data().firstName || ''} ${d.data().lastName || ''}`.trim(),
      }));
      setCompanyUsers(users);
    } catch (e) {
      console.error('Failed to fetch company users:', e);
    }
  };

  const handleSaveAssignments = async () => {
    if (!customer) return;
    setIsUpdating(true);
    try {
      const prevIds: string[] = customer.assignedUserIds || [];
      const addedIds = selectedUserIds.filter((uid) => !prevIds.includes(uid));
      const removedIds = prevIds.filter((uid) => !selectedUserIds.includes(uid));

      const toName = (uid: string) => companyUsers.find((u) => u.id === uid)?.name || uid;
      const addedNames = addedIds.map(toName);
      const removedNames = removedIds.map(toName);

      const actor = userProfile?.firstName || 'User';
      const date = new Date().toLocaleDateString();

      let historyString: string;
      if (addedIds.length > 0 && removedIds.length > 0) {
        historyString = `${actor} added ${addedNames.join(', ')} and removed ${removedNames.join(', ')} on ${date}`;
      } else if (addedIds.length > 0) {
        historyString = `${actor} assigned this to ${addedNames.join(', ')} on ${date}`;
      } else if (removedIds.length > 0) {
        historyString = `${actor} removed ${removedNames.join(', ')} from this customer on ${date}`;
      } else {
        // No changes — just close
        setIsAssignModalVisible(false);
        setIsUpdating(false);
        return;
      }

      // Update the customer document
      await updateDoc(doc(db, 'customers', id), {
        assignedUserIds: selectedUserIds,
        assignmentHistory: arrayUnion(historyString),
      });

      // Sync assignedUserIds onto all associated jobs
      const jobsSnap = await getDocs(
        query(collection(db, 'jobs'), where('customerId', '==', id)),
      );
      await Promise.all(
        jobsSnap.docs.map((d) => updateDoc(d.ref, { assignedUserIds: selectedUserIds })),
      );

      setIsAssignModalVisible(false);
    } catch (e) {
      console.error('Failed to save assignments:', e);
      Alert.alert('Error', 'Could not save assignments.');
    } finally {
      setIsUpdating(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Customer Profile', headerBackTitle: 'Back' }} />
        <ActivityIndicator size="large" color="#2e7d32" />
      </View>
    );
  }

  if (!customer) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Customer Profile', headerBackTitle: 'Back' }} />
        <Text style={styles.notFoundText}>Customer not found.</Text>
      </View>
    );
  }

  const fullName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || '—';
  const assignedUserIds: string[] = customer.assignedUserIds ?? [];
  const assignmentHistory: string[] = customer.assignmentHistory ?? [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <Stack.Screen options={{ title: 'Customer Profile', headerBackTitle: 'Back' }} />

      {/* ── Assigned Reps ── */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Assigned Reps</Text>
          <Pressable
            style={styles.manageBtn}
            onPress={() => {
              setSelectedUserIds(customer.assignedUserIds || []);
              fetchCompanyUsers();
              setIsAssignModalVisible(true);
            }}
          >
            <Ionicons name="pencil" size={14} color="#2e7d32" />
            <Text style={styles.manageBtnText}>Manage</Text>
          </Pressable>
        </View>
        {assignedUserIds.length > 0 ? (
          <View style={styles.chipsRow}>
            {assignedUserIds.map((uid) => {
              const user = companyUsers.find((u) => u.id === uid);
              return (
                <View key={uid} style={styles.chip}>
                  <Text style={styles.chipText}>{user?.name || uid}</Text>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.emptyValue}>Unassigned</Text>
        )}
      </View>

      {/* ── Contact ── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Contact</Text>
        <Text style={styles.nameText}>{fullName}</Text>
        <Field label="Phone" value={customer.phone} />
        <Field label="Email" value={customer.email} />
      </View>

      {/* ── Location ── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Location</Text>
        <Field label="Address" value={customer.address} />
        <Field label="Alternate Address" value={customer.alternateAddress} />
      </View>

      {/* ── Details ── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Details</Text>
        <Field label="Lead Source" value={customer.leadSource} />
        <Field label="Notes" value={customer.notes} />
      </View>

      {/* ── Assignment History ── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Assignment History</Text>
        {assignmentHistory.length > 0 ? (
          assignmentHistory.map((entry, i) => (
            <Text key={i} style={styles.historyText}>{entry}</Text>
          ))
        ) : (
          <Text style={styles.emptyValue}>No history.</Text>
        )}
      </View>

      {/* ── Assignment Modal ── */}
      <Modal
        visible={isAssignModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsAssignModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Assign Reps</Text>
              <TouchableOpacity
                onPress={() => setIsAssignModalVisible(false)}
                style={styles.modalCloseBtn}
              >
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* User list */}
            <FlatList
              data={companyUsers}
              keyExtractor={(item) => item.id}
              style={styles.modalList}
              renderItem={({ item }) => {
                const isSelected = selectedUserIds.includes(item.id);
                return (
                  <TouchableOpacity
                    style={[styles.userRow, isSelected && styles.userRowSelected]}
                    onPress={() =>
                      setSelectedUserIds((prev) =>
                        prev.includes(item.id)
                          ? prev.filter((uid) => uid !== item.id)
                          : [...prev, item.id],
                      )
                    }
                  >
                    <Text style={[styles.userName, isSelected && styles.userNameSelected]}>
                      {item.name}
                    </Text>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={20} color="#2e7d32" />
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={[styles.emptyValue, { textAlign: 'center', marginTop: 24 }]}>
                  No users found.
                </Text>
              }
            />

            {/* Footer */}
            <TouchableOpacity
              style={[styles.saveBtn, isUpdating && styles.saveBtnDisabled]}
              onPress={handleSaveAssignments}
              disabled={isUpdating}
            >
              <Text style={styles.saveBtnText}>
                {isUpdating ? 'Saving...' : 'Save Assignments'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value?.trim() || 'N/A'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scroll: {
    padding: 16,
    gap: 12,
    paddingBottom: 48,
  },

  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  notFoundText: {
    fontSize: 16,
    color: '#999',
  },

  // Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Name
  nameText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1a1a1a',
    marginTop: -4,
  },

  // Field row
  fieldRow: {
    gap: 2,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#aaa',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  fieldValue: {
    fontSize: 15,
    color: '#1a1a1a',
  },

  // Manage button
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
  },
  manageBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2e7d32',
  },

  // Rep chips
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: '#e8f5e9',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2e7d32',
  },

  emptyValue: {
    fontSize: 14,
    color: '#bbb',
    fontStyle: 'italic',
  },

  // History
  historyText: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 36,
    maxHeight: '75%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalCloseBtnText: {
    fontSize: 16,
    color: '#999',
    fontWeight: '600',
  },
  modalList: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginVertical: 3,
    backgroundColor: '#fafafa',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  userRowSelected: {
    backgroundColor: '#e8f5e9',
    borderColor: '#2e7d32',
  },
  userName: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
  },
  userNameSelected: {
    color: '#2e7d32',
    fontWeight: '700',
  },
  saveBtn: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#2e7d32',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: '#a5d6a7',
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
