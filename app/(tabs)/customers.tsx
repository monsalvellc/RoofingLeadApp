import { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../config/firebaseConfig';
import { useAuth } from '../../context/AuthContext';

export default function CustomersScreen() {
  const router = useRouter();
  const { userProfile } = useAuth();

  const [customers, setCustomers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Firebase listener
  useEffect(() => {
    if (!userProfile?.companyId) return;
    const q = query(
      collection(db, 'customers'),
      where('companyId', '==', userProfile.companyId),
      orderBy('createdAt', 'desc'),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCustomers(data);
      },
      (error) => {
        console.error('CUSTOMERS SNAPSHOT ERROR:', error);
      },
    );
    return unsubscribe;
  }, [userProfile?.companyId]);

  // Smart search
  const filteredCustomers = (() => {
    if (!searchQuery.trim()) return customers;
    const lowerQuery = searchQuery.trim().toLowerCase();
    const numericQuery = searchQuery.replace(/\D/g, '');
    return customers.filter((c) => {
      const firstName = (c.firstName || '').toLowerCase();
      const lastName = (c.lastName || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      const address = (c.address || '').toLowerCase();
      const phone = (c.phone || '').replace(/\D/g, '');

      if (firstName.includes(lowerQuery)) return true;
      if (lastName.includes(lowerQuery)) return true;
      if (`${firstName} ${lastName}`.includes(lowerQuery)) return true;
      if (email.includes(lowerQuery)) return true;
      if (address.includes(lowerQuery)) return true;
      if (numericQuery.length > 0 && phone.includes(numericQuery)) return true;
      return false;
    });
  })();

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Customers Directory</Text>
        <Text style={styles.subtitle}>{filteredCustomers.length} Total</Text>
      </View>

      {/* Search bar */}
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
      </View>

      {/* List */}
      {customers.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No customers yet.</Text>
        </View>
      ) : filteredCustomers.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No customers match your search.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredCustomers}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/customer/${item.id}`)}
            >
              {/* Name */}
              <Text style={styles.customerName}>
                {`${item.firstName || ''} ${item.lastName || ''}`.trim() || '—'}
              </Text>

              {/* Phone + Email */}
              {(item.phone || item.email) ? (
                <View style={styles.cardRow}>
                  {item.phone ? (
                    <Text style={styles.cardMeta}>{item.phone}</Text>
                  ) : null}
                  {item.phone && item.email ? (
                    <Text style={styles.cardMetaDivider}>·</Text>
                  ) : null}
                  {item.email ? (
                    <Text style={styles.cardMeta} numberOfLines={1}>{item.email}</Text>
                  ) : null}
                </View>
              ) : null}

              {/* Address */}
              {item.address ? (
                <Text style={styles.cardAddress} numberOfLines={1}>{item.address}</Text>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },

  // Header
  header: {
    backgroundColor: '#2e7d32',
    paddingTop: 60,
    paddingBottom: 24,
    paddingHorizontal: 24,
  },
  title: {
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
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  searchInputWrapper: {
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
    paddingBottom: 40,
  },

  // Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  customerName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  cardMeta: {
    fontSize: 14,
    color: '#666',
  },
  cardMetaDivider: {
    fontSize: 14,
    color: '#ccc',
  },
  cardAddress: {
    fontSize: 13,
    color: '#999',
    marginTop: 2,
  },
});
