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
import { MaterialIcons } from '@expo/vector-icons';

export default function Drive() {
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState("grid");
  const [createFolderModal, setCreateFolderModal] = useState(false);
  const [renameModal, setRenameModal] = useState({ visible: false, type: null, item: null, newName: "" });

  const BASE_URL = "http://192.168.45.20:3002";

  // 🔄 Charger dossiers
  const loadFolders = async () => {
    try {
      const res = await axios.get(`${BASE_URL}/folders`);
      const validFolders = res.data.filter(f => f && f.id !== undefined);
      
      // Obtenir le nombre de fichiers pour chaque dossier
      const foldersWithFileCount = await Promise.all(
        validFolders.map(async (folder) => {
          const countRes = await axios.get(`${BASE_URL}/folders/${folder.id}/file-count`);
          return { ...folder, fileCount: countRes.data.count };
        })
      );
      
      setFolders(foldersWithFileCount);
      if (!selectedFolder && foldersWithFileCount.length > 0) setSelectedFolder(foldersWithFileCount[0]);
    } catch (err) {
      console.error(err);
      Alert.alert("Erreur", "Impossible de charger les dossiers");
    }
  };

  // 🔄 Charger fichiers
  const loadFiles = async (folderId) => {
    try {
      const res = await axios.get(`${BASE_URL}/files`);
      setFiles(res.data.filter(f => f && f.id !== undefined && f.folder_id === folderId));
    } catch (err) { console.error(err); }
  };

  // ➕ Ajouter dossier
  const addFolder = async () => {
    if (!newFolderName.trim()) return;
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
  const deleteFolder = async (id, name) => {
    Alert.alert(
      "Supprimer le dossier", 
      `Êtes-vous sûr de vouloir supprimer "${name}" ? Tous les fichiers qu'il contient seront également supprimés.`,
      [
        { text: "Annuler", style: "cancel" },
        { 
          text: "Supprimer", 
          style: "destructive", 
          onPress: async () => { 
            try {
              await axios.delete(`${BASE_URL}/folders/${id}`); 
              if (selectedFolder?.id === id) setSelectedFolder(null); 
              loadFolders();
              Alert.alert("Succès", "Dossier supprimé avec succès");
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
  const deleteFile = async (id, name) => {
    Alert.alert(
      "Supprimer le fichier", 
      `Êtes-vous sûr de vouloir supprimer "${name}" ?`,
      [
        { text: "Annuler", style: "cancel" },
        { 
          text: "Supprimer", 
          style: "destructive", 
          onPress: async () => { 
            try {
              await axios.delete(`${BASE_URL}/files/${id}`); 
              loadFiles(selectedFolder.id);
              Alert.alert("Succès", "Fichier supprimé avec succès");
            } catch (err) {
              console.error(err); 
              Alert.alert("Erreur", "Impossible de supprimer le fichier"); 
            }
          } 
        }
      ]
    );
  };

  // ✏️ Renommer dossier ou fichier
  const renameItem = async () => {
    const { type, item, newName } = renameModal;
    if (!newName.trim()) {
      Alert.alert("Erreur", "Veuillez entrer un nom valide");
      return;
    }

    try {
      const endpoint = type === "folder" ? "folders" : "files";
      await axios.put(`${BASE_URL}/${endpoint}/${item.id}`, { name: newName });
      
      setRenameModal({ visible: false, type: null, item: null, newName: "" });
      
      if (type === "folder") {
        loadFolders();
        // Mettre à jour le dossier sélectionné si c'est celui qui a été renommé
        if (selectedFolder?.id === item.id) {
          setSelectedFolder({ ...selectedFolder, name: newName });
        }
      } else {
        loadFiles(selectedFolder.id);
      }
      
      Alert.alert("Succès", `${type === "folder" ? "Dossier" : "Fichier"} renommé avec succès`);
    } catch (err) {
      console.error(err);
      Alert.alert("Erreur", `Impossible de renommer le ${type === "folder" ? "dossier" : "fichier"}`);
    }
  };

  // 🔹 Upload Web
  const handleFileUploadWeb = async (event) => {
    if (!selectedFolder) { Alert.alert("Sélectionnez un dossier"); return; }
    const file = event.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder_id", selectedFolder.id);
    try { 
      await axios.post(`${BASE_URL}/upload`, formData, { headers: { "Content-Type": "multipart/form-data" } }); 
      loadFiles(selectedFolder.id); 
      Alert.alert("Succès", "Fichier uploadé avec succès");
    } catch (err) { 
      console.error(err); 
      Alert.alert("Erreur", "Impossible d'uploader le fichier"); 
    }
  };

  // 🔹 Upload Mobile
  const handleFileUploadMobile = async () => {
    if (!selectedFolder) { Alert.alert("Sélectionnez un dossier"); return; }
    const result = await DocumentPicker.getDocumentAsync({});
    if (result.type === "cancel") return;
    const { name, uri } = result;
    const fileType = name.split(".").pop();
    const formData = new FormData();
    formData.append("file", { uri, name, type: `application/${fileType}` });
    formData.append("folder_id", selectedFolder.id);
    try { 
      await axios.post(`${BASE_URL}/upload`, formData, { headers: { "Content-Type": "multipart/form-data" } }); 
      loadFiles(selectedFolder.id); 
      Alert.alert("Succès", "Fichier uploadé avec succès");
    } catch (err) { 
      console.error(err); 
      Alert.alert("Erreur", "Impossible d'uploader le fichier"); 
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

  // 🔹 Aperçu fichiers
  const renderFilePreview = (file) => {
    if (!file.url) return <MaterialIcons name="insert-drive-file" size={40} color="#777" />;
    if (file.url.match(/\.(jpg|jpeg|png|gif)$/i)) return <Image source={{ uri: file.url }} style={styles.fileThumbnail} />;
    if (file.url.match(/\.(pdf)$/i)) return <MaterialIcons name="picture-as-pdf" size={40} color="#d93025" />;
    return <MaterialIcons name="insert-drive-file" size={40} color="#777" />;
  };

  // 🔹 Rendu d'un fichier
  const renderFileItem = ({ item }) => (
    <View style={[
      styles.fileItem, 
      viewMode === "grid" ? styles.fileGrid : styles.fileList
    ]}>
      <View style={styles.fileContent}>
        <View style={styles.fileIconContainer}>
          {renderFilePreview(item)}
        </View>
        
        <View style={styles.fileInfo}>
          <Text style={styles.fileName} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={styles.fileDetails}>
            {item.size ? `${formatFileSize(item.size)}` : ""}
          </Text>
        </View>
      </View>
      
      <View style={styles.fileActions}>
        <TouchableOpacity 
          style={styles.fileAction}
          onPress={() => setRenameModal({ 
            visible: true, 
            type: "file", 
            item, 
            newName: item.name 
          })}
        >
          <MaterialIcons name="edit" size={18} color="#666" />
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.fileAction}
          onPress={() => deleteFile(item.id, item.name)}
        >
          <MaterialIcons name="delete" size={18} color="#666" />
        </TouchableOpacity>
      </View>
    </View>
  );

  // 🔹 Rendu d'un dossier - SIMPLIFIÉ avec juste le nombre de fichiers
  const renderFolderItem = ({ item }) => {
    const filesCount = files.filter(f => f.folder_id === item.id).length;
    
    return (
      <TouchableOpacity 
        style={[
          styles.folderItem,
          viewMode === "grid" ? styles.folderGrid : styles.folderList,
          selectedFolder?.id === item.id && styles.folderSelected
        ]}
        onPress={() => setSelectedFolder(item)}
      >
        <View style={styles.folderContent}>
          <View style={styles.folderIcon}>
            <MaterialIcons name="folder" size={viewMode === "grid" ? 48 : 32} color="#fbc02d" />
          </View>
          
          <View style={styles.folderInfo}>
            <Text style={styles.folderName} numberOfLines={2}>
              {item.name}
            </Text>
            <Text style={styles.folderDetails}>
              {filesCount} {filesCount === 1 ? 'fichier' : 'fichiers'}
            </Text>
          </View>
        </View>
        
        <View style={styles.folderActions}>
          <TouchableOpacity 
            style={styles.folderAction}
            onPress={() => setRenameModal({ 
              visible: true, 
              type: "folder", 
              item, 
              newName: item.name 
            })}
          >
            <MaterialIcons name="edit" size={18} color="#666" />
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.folderAction}
            onPress={() => deleteFolder(item.id, item.name)}
          >
            <MaterialIcons name="delete" size={18} color="#666" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

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
          <MaterialIcons name="cloud" size={32} color="#4285f4" />
          <Text style={styles.headerTitle}>Drive Public</Text>
        </View>
        
        <View style={styles.headerRight}>
          <TouchableOpacity 
            style={styles.headerButton}
            onPress={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
          >
            <MaterialIcons 
              name={viewMode === "grid" ? "view-list" : "view-module"} 
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
          <MaterialIcons name="create-new-folder" size={20} color="#5f6368" />
          <Text style={styles.toolbarButtonText}>Nouveau dossier</Text>
        </TouchableOpacity>

        {selectedFolder && (
          Platform.OS === "web" ? (
            <TouchableOpacity style={styles.toolbarButton}>
              <label htmlFor="file-upload" style={styles.uploadLabel}>
                <MaterialIcons name="upload-file" size={20} color="#5f6368" />
                <Text style={styles.toolbarButtonText}>Uploader</Text>
              </label>
              <input
                id="file-upload"
                type="file"
                style={{ display: 'none' }}
                onChange={handleFileUploadWeb}
              />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              style={styles.toolbarButton}
              onPress={handleFileUploadMobile}
            >
              <MaterialIcons name="upload-file" size={20} color="#5f6368" />
              <Text style={styles.toolbarButtonText}>Uploader</Text>
            </TouchableOpacity>
          )
        )}

        <TouchableOpacity 
          style={styles.toolbarButton}
          onPress={onRefresh}
        >
          <MaterialIcons name="refresh" size={20} color="#5f6368" />
          <Text style={styles.toolbarButtonText}>Actualiser</Text>
        </TouchableOpacity>
      </View>

      {/* Breadcrumb */}
      <View style={styles.breadcrumb}>
        <Text style={styles.breadcrumbText}>
          Drive Public {selectedFolder && `> ${selectedFolder.name}`}
        </Text>
      </View>

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
            <MaterialIcons name="folder-open" size={64} color="#dadce0" />
            <Text style={styles.emptyStateText}>Aucun dossier</Text>
          </View>
        )}

        {/* Fichiers */}
        {selectedFolder && (
          <>
            <Text style={styles.sectionTitle}>Fichiers dans {selectedFolder.name}</Text>
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
                <MaterialIcons name="insert-drive-file" size={64} color="#dadce0" />
                <Text style={styles.emptyStateText}>Aucun fichier dans ce dossier</Text>
              </View>
            )}
          </>
        )}

        {!selectedFolder && folders.length > 0 && (
          <View style={styles.emptyState}>
            <MaterialIcons name="folder-open" size={64} color="#dadce0" />
            <Text style={styles.emptyStateText}>Sélectionnez un dossier pour voir ses fichiers</Text>
          </View>
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

      {/* Modal renommage */}
      <Modal
        visible={renameModal.visible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setRenameModal({ visible: false, type: null, item: null, newName: "" })}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              Renommer le {renameModal.type === "folder" ? "dossier" : "fichier"}
            </Text>
            
            <TextInput
              placeholder={`Nouveau nom ${renameModal.type === "folder" ? "du dossier" : "du fichier"}`}
              value={renameModal.newName}
              onChangeText={(text) => setRenameModal(prev => ({ ...prev, newName: text }))}
              style={styles.modalInput}
              autoFocus
            />
            
            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => setRenameModal({ visible: false, type: null, item: null, newName: "" })}
              >
                <Text style={styles.modalButtonTextCancel}>Annuler</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalButton, styles.modalButtonConfirm]}
                onPress={renameItem}
                disabled={!renameModal.newName.trim()}
              >
                <Text style={styles.modalButtonTextConfirm}>Renommer</Text>
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
  uploadLabel: {
    flexDirection: "row",
    alignItems: "center",
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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  folderGrid: {
    width: "48%",
    marginHorizontal: "1%",
    padding: 16,
  },
  folderList: {
    padding: 12,
  },
  folderSelected: {
    borderColor: "#4285f4",
    backgroundColor: "#f0f6ff",
  },
  folderContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  folderIcon: {
    marginRight: 12,
  },
  folderInfo: {
    flex: 1,
  },
  folderName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#3c4043",
  },
  folderDetails: {
    fontSize: 12,
    color: "#5f6368",
    marginTop: 4,
  },
  folderActions: {
    flexDirection: "row",
  },
  folderAction: {
    padding: 6,
    marginLeft: 4,
  },
  // Styles pour les fichiers 
  fileItem: {
    backgroundColor: "white",
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#dadce0",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  fileGrid: {
    width: "48%",
    marginHorizontal: "1%",
    padding: 16,
  },
  fileList: {
    padding: 12,
  },
  fileContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  fileIconContainer: {
    marginRight: 12,
  },
  fileThumbnail: {
    width: 40,
    height: 40,
    borderRadius: 4,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#3c4043",
  },
  fileDetails: {
    fontSize: 12,
    color: "#5f6368",
    marginTop: 4,
  },
  fileActions: {
    flexDirection: "row",
  },
  fileAction: {
    padding: 6,
    marginLeft: 4,
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
    textAlign: "center",
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