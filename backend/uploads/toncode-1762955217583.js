import React, { useEffect, useState } from "react";
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  FlatList, 
  Alert, 
  StyleSheet, 
  Image, 
  Platform,
  Modal,
  ScrollView,
  RefreshControl
} from "react-native";
import axios from "axios";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";

export default function Drive() {
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState("grid"); // "grid" or "list"
  const [createFolderModal, setCreateFolderModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const BASE_URL = "http://192.168.45.20:3002";

  // 🔄 Charger dossiers
  const loadFolders = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${BASE_URL}/folders`);
      const validFolders = res.data.filter(f => f && f.id !== undefined);
      setFolders(validFolders);
      if (!selectedFolder && validFolders.length > 0) setSelectedFolder(validFolders[0]);
    } catch (err) {
      console.error(err);
      Alert.alert("Erreur", "Impossible de charger les dossiers");
    } finally {
      setLoading(false);
    }
  };

  // 🔄 Charger fichiers du dossier
  const loadFiles = async (folderId) => {
    try {
      const res = await axios.get(`${BASE_URL}/files`);
      const folderFiles = res.data.filter(f => f && f.id !== undefined && f.folder_id === folderId);
      setFiles(folderFiles);
    } catch (err) {
      console.error(err);
    }
  };

  // ➕ Ajouter dossier
  const addFolder = async () => {
    if (!newFolderName.trim()) {
      Alert.alert("Erreur", "Veuillez entrer un nom de dossier");
      return;
    }
    try {
      await axios.post(`${BASE_URL}/folders`, { name: newFolderName });
      setNewFolderName("");
      setCreateFolderModal(false);
      loadFolders();
      Alert.alert("Succès", "Dossier créé avec succès");
    } catch (err) {
      console.error(err);
      Alert.alert("Erreur", "Impossible de créer le dossier");
    }
  };

  // 🗑️ Supprimer dossier
  const deleteFolder = async (folderId) => {
    Alert.alert(
      "Supprimer le dossier", 
      "Êtes-vous sûr de vouloir supprimer ce dossier ? Tous les fichiers qu'il contient seront également supprimés.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer", 
          style: "destructive", 
          onPress: async () => {
            try {
              await axios.delete(`${BASE_URL}/folders/${folderId}`);
              if (selectedFolder?.id === folderId) setSelectedFolder(null);
              loadFolders();
              Alert.alert("Succès", "Dossier supprimé");
            } catch (err) {
              console.error(err);
              Alert.alert("Erreur", "Impossible de supprimer le dossier");
            }
          }
        }
      ]
    );
  };

  // 🗑️ Supprimer fichier
  const deleteFile = async (fileId, fileName) => {
    Alert.alert(
      "Supprimer le fichier", 
      `Êtes-vous sûr de vouloir supprimer "${fileName}" ?`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer", 
          style: "destructive", 
          onPress: async () => {
            try {
              await axios.delete(`${BASE_URL}/files/${fileId}`);
              loadFiles(selectedFolder.id);
              Alert.alert("Succès", "Fichier supprimé");
            } catch (err) {
              console.error(err);
              Alert.alert("Erreur", "Impossible de supprimer le fichier");
            }
          }
        }
      ]
    );
  };

  // 🔹 Upload fichier Mobile
  const handleFileUploadMobile = async () => {
    if (!selectedFolder) { 
      Alert.alert("Sélectionnez un dossier", "Veuillez d'abord sélectionner un dossier pour uploader le fichier");
      return; 
    }
    
    try {
      const result = await DocumentPicker.getDocumentAsync({});
      if (result.type === "cancel") return;
      
      const { name, uri } = result;
      let fileType = name.split(".").pop();
      const formData = new FormData();
      formData.append("file", { 
        uri, 
        name, 
        type: `application/${fileType}` 
      });
      formData.append("folder_id", selectedFolder.id);
      
      setLoading(true);
      await axios.post(`${BASE_URL}/upload`, formData, { 
        headers: { "Content-Type": "multipart/form-data" } 
      });
      
      loadFiles(selectedFolder.id);
      Alert.alert("Succès", "Fichier uploadé avec succès");
    } catch (err) {
      console.error(err);
      Alert.alert("Erreur", "Impossible d'uploader le fichier");
    } finally {
      setLoading(false);
    }
  };

  // 🔄 Refresh
  const onRefresh = async () => {
    setRefreshing(true);
    await loadFolders();
    if (selectedFolder) await loadFiles(selectedFolder.id);
    setRefreshing(false);
  };

  // 🔄 Effets
  useEffect(() => { loadFolders(); }, []);
  useEffect(() => { 
    if (selectedFolder) loadFiles(selectedFolder.id); 
    else setFiles([]); 
  }, [selectedFolder]);

  // 🔹 Rendu d'un fichier
  const renderFileItem = ({ item }) => {
    const isImage = item.url?.match(/\.(jpg|jpeg|png|gif)$/i);
    const isPDF = item.name?.match(/\.pdf$/i);
    const isDocument = item.name?.match(/\.(doc|docx|txt)$/i);
    
    return (
      <TouchableOpacity 
        style={[
          styles.fileItem, 
          viewMode === "grid" ? styles.fileGrid : styles.fileList
        ]}
        onPress={() => Alert.alert(item.name, `Type: ${item.type || "Fichier"}`)}
      >
        <View style={styles.fileIconContainer}>
          {isImage ? (
            <Image source={{ uri: item.url }} style={styles.fileThumbnail} />
          ) : isPDF ? (
            <Ionicons name="document-text" size={40} color="#e53935" />
          ) : isDocument ? (
            <Ionicons name="document" size={40} color="#1976d2" />
          ) : (
            <Ionicons name="document-outline" size={40} color="#666" />
          )}
        </View>
        
        <View style={styles.fileInfo}>
          <Text style={styles.fileName} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={styles.fileDetails}>
            {item.size ? `• ${formatFileSize(item.size)}` : ""}
          </Text>
        </View>
        
        <TouchableOpacity 
          style={styles.fileAction}
          onPress={() => deleteFile(item.id, item.name)}
        >
          <Ionicons name="trash-outline" size={20} color="#666" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  // 🔹 Rendu d'un dossier
  const renderFolderItem = ({ item }) => (
    <TouchableOpacity 
      style={[
        styles.folderItem,
        viewMode === "grid" ? styles.folderGrid : styles.folderList,
        selectedFolder?.id === item.id && styles.folderSelected
      ]}
      onPress={() => setSelectedFolder(item)}
    >
      <View style={styles.folderIcon}>
        <Ionicons name="folder" size={viewMode === "grid" ? 48 : 32} color="#fbc02d" />
      </View>
      
      <View style={styles.folderInfo}>
        <Text style={styles.folderName} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.folderDetails}>
          {item.file_count ? `${item.file_count} fichiers` : "Dossier vide"}
        </Text>
      </View>
      
      <TouchableOpacity 
        style={styles.folderAction}
        onPress={() => deleteFolder(item.id)}
      >
        <Ionicons name="more-vert" size={20} color="#666" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  // 🔹 Formatage taille fichier
  const formatFileSize = (bytes) => {
    if (!bytes) return "";
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="cloud" size={32} color="#4285f4" />
          <Text style={styles.headerTitle}>Drive Public</Text>
        </View>
        
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerButton}>
            <Ionicons name="search" size={24} color="#5f6368" />
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.headerButton}
            onPress={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
          >
            <Ionicons 
              name={viewMode === "grid" ? "list" : "grid"} 
              size={24} 
              color="#5f6368" 
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <TouchableOpacity 
          style={styles.toolbarButton}
          onPress={() => setCreateFolderModal(true)}
        >
          <Ionicons name="add" size={20} color="#5f6368" />
          <Text style={styles.toolbarButtonText}>Nouveau dossier</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.toolbarButton}
          onPress={handleFileUploadMobile}
          disabled={!selectedFolder}
        >
          <Ionicons name="cloud-upload" size={20} color="#5f6368" />
          <Text style={styles.toolbarButtonText}>Uploader</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.toolbarButton}
          onPress={onRefresh}
        >
          <Ionicons name="refresh" size={20} color="#5f6368" />
          <Text style={styles.toolbarButtonText}>Actualiser</Text>
        </TouchableOpacity>
      </View>

      {/* Breadcrumb */}
      {selectedFolder && (
        <View style={styles.breadcrumb}>
          <Text style={styles.breadcrumbText}>
            Drive Public {selectedFolder && `> ${selectedFolder.name}`}
          </Text>
        </View>
      )}

      {/* Content */}
      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Dossiers */}
        <Text style={styles.sectionTitle}>Dossiers</Text>
        {folders.length > 0 ? (
          <FlatList
            data={folders.filter(f => f && f.id !== undefined)}
            key={viewMode}
            numColumns={viewMode === "grid" ? 2 : 1}
            keyExtractor={item => item.id?.toString() || Math.random().toString()}
            renderItem={renderFolderItem}
            scrollEnabled={false}
            contentContainerStyle={styles.foldersContainer}
          />
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="folder-open" size={64} color="#dadce0" />
            <Text style={styles.emptyStateText}>Aucun dossier</Text>
          </View>
        )}

        {/* Fichiers */}
        {selectedFolder && (
          <>
            <Text style={styles.sectionTitle}>Fichiers</Text>
            {files.length > 0 ? (
              <FlatList
                data={files.filter(f => f && f.id !== undefined)}
                key={viewMode}
                numColumns={viewMode === "grid" ? 2 : 1}
                keyExtractor={item => item.id?.toString() || Math.random().toString()}
                renderItem={renderFileItem}
                scrollEnabled={false}
                contentContainerStyle={styles.filesContainer}
              />
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="document-outline" size={64} color="#dadce0" />
                <Text style={styles.emptyStateText}>Aucun fichier dans ce dossier</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Modal création dossier */}
      <Modal
        visible={createFolderModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setCreateFolderModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Nouveau dossier</Text>
            
            <TextInput
              placeholder="Nom du dossier"
              value={newFolderName}
              onChangeText={setNewFolderName}
              style={styles.modalInput}
              autoFocus
            />
            
            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => setCreateFolderModal(false)}
              >
                <Text style={styles.modalButtonTextCancel}>Annuler</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalButton, styles.modalButtonConfirm]}
                onPress={addFolder}
                disabled={!newFolderName.trim()}
              >
                <Text style={styles.modalButtonTextConfirm}>Créer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#dadce0",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "500",
    color: "#3c4043",
    marginLeft: 12,
  },
  headerRight: {
    flexDirection: "row",
  },
  headerButton: {
    padding: 8,
    marginLeft: 8,
  },
  toolbar: {
    flexDirection: "row",
    padding: 16,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#dadce0",
  },
  toolbarButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#f8f9fa",
    borderRadius: 4,
    marginRight: 12,
  },
  toolbarButtonText: {
    marginLeft: 8,
    color: "#5f6368",
    fontSize: 14,
  },
  breadcrumb: {
    padding: 16,
    backgroundColor: "white",
  },
  breadcrumbText: {
    color: "#5f6368",
    fontSize: 14,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#3c4043",
    marginBottom: 12,
  },
  foldersContainer: {
    paddingBottom: 16,
  },
  filesContainer: {
    paddingBottom: 16,
  },
  // Styles pour les dossiers
  folderItem: {
    backgroundColor: "white",
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#dadce0",
  },
  folderGrid: {
    width: "48%",
    marginHorizontal: "1%",
    padding: 16,
    alignItems: "center",
  },
  folderList: {
    flexDirection: "row",
    padding: 12,
    alignItems: "center",
  },
  folderSelected: {
    borderColor: "#4285f4",
    backgroundColor: "#f0f6ff",
  },
  folderIcon: {
    marginBottom: 8,
  },
  folderInfo: {
    flex: 1,
    alignItems: "center",
  },
  folderName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#3c4043",
    textAlign: "center",
  },
  folderDetails: {
    fontSize: 12,
    color: "#5f6368",
    marginTop: 4,
  },
  folderAction: {
    padding: 4,
  },
  // Styles pour les fichiers
  fileItem: {
    backgroundColor: "white",
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#dadce0",
  },
  fileGrid: {
    width: "48%",
    marginHorizontal: "1%",
    padding: 16,
    alignItems: "center",
  },
  fileList: {
    flexDirection: "row",
    padding: 12,
    alignItems: "center",
  },
  fileIconContainer: {
    marginBottom: 8,
  },
  fileThumbnail: {
    width: 64,
    height: 64,
    borderRadius: 4,
  },
  fileInfo: {
    flex: 1,
    alignItems: "center",
  },
  fileName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#3c4043",
    textAlign: "center",
  },
  fileDetails: {
    fontSize: 12,
    color: "#5f6368",
    marginTop: 4,
  },
  fileAction: {
    padding: 4,
  },
  // États vides
  emptyState: {
    alignItems: "center",
    padding: 40,
  },
  emptyStateText: {
    marginTop: 16,
    color: "#5f6368",
    fontSize: 16,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "white",
    borderRadius: 8,
    padding: 24,
    width: "80%",
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "500",
    marginBottom: 16,
    color: "#3c4043",
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#dadce0",
    borderRadius: 4,
    padding: 12,
    fontSize: 16,
    marginBottom: 24,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  modalButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  modalButtonCancel: {
    backgroundColor: "transparent",
  },
  modalButtonConfirm: {
    backgroundColor: "#4285f4",
  },
  modalButtonTextCancel: {
    color: "#5f6368",
    fontSize: 14,
  },
  modalButtonTextConfirm: {
    color: "white",
    fontSize: 14,
    fontWeight: "500",
  },
});