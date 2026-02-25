import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { Ionicons } from '@expo/vector-icons';
import { db } from '../../config/firebaseConfig';
import { useAuth } from '../../context/AuthContext';

export default function CustomerProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { userProfile } = useAuth();

  const [customer, setCustomer] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

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
  const assignmentHistory: { text: string; timestamp: any }[] = customer.assignmentHistory ?? [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <Stack.Screen options={{ title: 'Customer Profile', headerBackTitle: 'Back' }} />

      {/* ── Assigned Reps ── */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Assigned Reps</Text>
          <Pressable
            style={styles.manageBtn}
            onPress={() => console.log('Open Assignment Modal')}
          >
            <Ionicons name="pencil" size={14} color="#2e7d32" />
            <Text style={styles.manageBtnText}>Manage</Text>
          </Pressable>
        </View>
        {assignedUserIds.length > 0 ? (
          <View style={styles.chipsRow}>
            {assignedUserIds.map((uid) => (
              <View key={uid} style={styles.chip}>
                <Text style={styles.chipText}>{uid}</Text>
              </View>
            ))}
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
            <View key={i} style={styles.historyRow}>
              <Text style={styles.historyText}>{entry.text}</Text>
              {entry.timestamp ? (
                <Text style={styles.historyTimestamp}>
                  {new Date(
                    entry.timestamp?.seconds ? entry.timestamp.seconds * 1000 : entry.timestamp,
                  ).toLocaleDateString()}
                </Text>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={styles.emptyValue}>No history.</Text>
        )}
      </View>
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
  historyRow: {
    gap: 2,
  },
  historyText: {
    fontSize: 14,
    color: '#333',
  },
  historyTimestamp: {
    fontSize: 12,
    color: '#aaa',
  },
});
