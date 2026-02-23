import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '../config/firebaseConfig';
import { LeadFile } from '../types';

const CATEGORIES = [
  'Inspection',
  'Install',
  'Documents',
] as const;

const PDF_CATEGORIES = new Set(['Documents']);

interface Props {
  onUpdate: (files: LeadFile[], permissions: Record<string, boolean>) => void;
}

export default function LeadImagePicker({ onUpdate }: Props) {
  const [files, setFiles] = useState<LeadFile[]>([]);
  const [folderPermissions, setFolderPermissions] = useState<Record<string, boolean>>(
    () => Object.fromEntries(CATEGORIES.map((c) => [c, false])),
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    () => Object.fromEntries(CATEGORIES.map((c) => [c, false])),
  );
  const [uploading, setUploading] = useState<string | null>(null);

  const toggleExpanded = (cat: string) => {
    setExpanded((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  const toggleFolderPermission = (cat: string, value: boolean) => {
    const next = { ...folderPermissions, [cat]: value };
    setFolderPermissions(next);
    onUpdate(files, next);
  };

  const toggleFilePublic = (fileId: string, value: boolean) => {
    const next = files.map((f) =>
      f.id === fileId ? { ...f, isPublic: value } : f,
    );
    setFiles(next);
    onUpdate(next, folderPermissions);
  };

  const deleteFile = (fileId: string) => {
    const next = files.filter((f) => f.id !== fileId);
    setFiles(next);
    onUpdate(next, folderPermissions);
  };

  const pickAndUpload = async (category: string) => {
    const permResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permResult.granted) {
      Alert.alert('Permission Required', 'Please allow photo access to upload files.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    const timestamp = Date.now();
    const filename = asset.fileName ?? `photo_${timestamp}.jpg`;
    const storagePath = `leads/TEMP_COMPANY_ID/${category}/${timestamp}_${filename}`;

    setUploading(category);

    try {
      const response = await fetch(asset.uri);
      const blob = await response.blob();

      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, blob);

      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          null,
          (error) => reject(error),
          () => resolve(),
        );
      });

      const downloadUrl = await getDownloadURL(storageRef);

      const newFile: LeadFile = {
        id: `file-${timestamp}`,
        url: downloadUrl,
        name: filename,
        type: 'image',
        category,
        isPublic: folderPermissions[category] ?? false,
        createdAt: timestamp,
        companyId: 'TEMP_COMPANY_ID',
      };

      const nextFiles = [...files, newFile];
      setFiles(nextFiles);
      onUpdate(nextFiles, folderPermissions);
    } catch (e: any) {
      console.error('Upload failed:', e);
      Alert.alert('Upload Failed', e.message);
    } finally {
      setUploading(null);
    }
  };

  const pickDocument = async (category: string) => {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    const timestamp = Date.now();
    const filename = asset.name ?? `document_${timestamp}.pdf`;
    const storagePath = `leads/TEMP_COMPANY_ID/${category}/${timestamp}_${filename}`;

    setUploading(category);

    try {
      const response = await fetch(asset.uri);
      const blob = await response.blob();

      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, blob);

      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          null,
          (error) => reject(error),
          () => resolve(),
        );
      });

      const downloadUrl = await getDownloadURL(storageRef);

      const newFile: LeadFile = {
        id: `file-${timestamp}`,
        url: downloadUrl,
        name: filename,
        type: 'pdf',
        category,
        isPublic: folderPermissions[category] ?? false,
        createdAt: timestamp,
        companyId: 'TEMP_COMPANY_ID',
      };

      const nextFiles = [...files, newFile];
      setFiles(nextFiles);
      onUpdate(nextFiles, folderPermissions);
    } catch (e: any) {
      console.error('Document upload failed:', e);
      Alert.alert('Upload Failed', e.message);
    } finally {
      setUploading(null);
    }
  };

  const categoryFiles = (cat: string) => files.filter((f) => f.category === cat);

  return (
    <View style={styles.container}>
      {CATEGORIES.map((cat) => {
        const catFiles = categoryFiles(cat);
        const isExpanded = expanded[cat];
        const isUploading = uploading === cat;

        return (
          <View key={cat} style={styles.folder}>
            {/* Folder header */}
            <Pressable
              style={styles.folderHeader}
              onPress={() => toggleExpanded(cat)}
            >
              <View style={styles.folderHeaderLeft}>
                <Text style={styles.folderArrow}>{isExpanded ? '▼' : '▶'}</Text>
                <Text style={styles.folderName}>
                  {cat} ({catFiles.length})
                </Text>
              </View>
              <View style={styles.folderHeaderRight}>
                <Text style={styles.shareLabel}>Share</Text>
                <Switch
                  value={folderPermissions[cat]}
                  onValueChange={(v) => toggleFolderPermission(cat, v)}
                  trackColor={{ false: '#ccc', true: '#81c784' }}
                  thumbColor={folderPermissions[cat] ? '#2e7d32' : '#f4f3f4'}
                />
              </View>
            </Pressable>

            {/* Folder body */}
            {isExpanded && (
              <View style={styles.folderBody}>
                {/* Action buttons */}
                <View style={styles.actionRow}>
                  <Pressable
                    style={[styles.addPhotoButton, styles.actionButton]}
                    onPress={() => pickAndUpload(cat)}
                    disabled={isUploading}
                  >
                    {isUploading ? (
                      <ActivityIndicator color="#2e7d32" />
                    ) : (
                      <Text style={styles.addPhotoText}>+ Add Photo</Text>
                    )}
                  </Pressable>

                  {PDF_CATEGORIES.has(cat) && (
                    <Pressable
                      style={[styles.addDocButton, styles.actionButton]}
                      onPress={() => pickDocument(cat)}
                      disabled={isUploading}
                    >
                      {isUploading ? (
                        <ActivityIndicator color="#1565c0" />
                      ) : (
                        <Text style={styles.addDocText}>+ Add PDF</Text>
                      )}
                    </Pressable>
                  )}
                </View>

                {/* File grid */}
                {catFiles.length > 0 && (
                  <View style={styles.photoGrid}>
                    {catFiles.map((file) => (
                      <View key={file.id} style={styles.photoItem}>
                        {file.type === 'pdf' ? (
                          <View style={styles.pdfThumbnail}>
                            <Text style={styles.pdfIcon}>PDF</Text>
                            <Text style={styles.pdfName} numberOfLines={2}>
                              {file.name}
                            </Text>
                          </View>
                        ) : (
                          <Image
                            source={{ uri: file.url }}
                            style={styles.thumbnail}
                          />
                        )}
                        <View style={styles.photoControls}>
                          <View style={styles.photoShareRow}>
                            <Text style={styles.photoShareLabel}>Public</Text>
                            <Switch
                              value={file.isPublic}
                              onValueChange={(v) => toggleFilePublic(file.id, v)}
                              trackColor={{ false: '#ccc', true: '#81c784' }}
                              thumbColor={file.isPublic ? '#2e7d32' : '#f4f3f4'}
                              style={styles.smallSwitch}
                            />
                          </View>
                          <Pressable
                            onPress={() => deleteFile(file.id)}
                            style={styles.deleteButton}
                          >
                            <Text style={styles.deleteText}>Delete</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },

  // Folder
  folder: {
    backgroundColor: '#fff',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  folderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#f9f9f9',
  },
  folderHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  folderArrow: {
    fontSize: 12,
    color: '#666',
  },
  folderName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  folderHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  shareLabel: {
    fontSize: 13,
    color: '#777',
  },

  // Folder body
  folderBody: {
    padding: 12,
    gap: 12,
  },

  // Action buttons
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
  },
  addPhotoButton: {
    borderWidth: 1.5,
    borderColor: '#2e7d32',
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#f1f8e9',
  },
  addPhotoText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2e7d32',
  },
  addDocButton: {
    borderWidth: 1.5,
    borderColor: '#1565c0',
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
  },
  addDocText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1565c0',
  },

  // PDF thumbnail
  pdfThumbnail: {
    width: 140,
    height: 100,
    backgroundColor: '#e3f2fd',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  pdfIcon: {
    fontSize: 22,
    fontWeight: '800',
    color: '#c62828',
    marginBottom: 4,
  },
  pdfName: {
    fontSize: 11,
    color: '#555',
    textAlign: 'center',
  },

  // Photo grid
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoItem: {
    width: 140,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#fafafa',
  },
  thumbnail: {
    width: 140,
    height: 100,
    resizeMode: 'cover',
  },
  photoControls: {
    padding: 8,
    gap: 6,
  },
  photoShareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  photoShareLabel: {
    fontSize: 12,
    color: '#666',
  },
  smallSwitch: {
    transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }],
  },
  deleteButton: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  deleteText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#c62828',
  },
});
