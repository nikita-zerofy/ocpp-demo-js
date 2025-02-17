import admin from 'firebase-admin';
import {DocumentReference, DocumentSnapshot, Query} from 'firebase-admin/firestore';
import {FirestoreDocument} from './firestore-document';

export abstract class FirestoreRepository<T extends FirestoreDocument> {
  protected modelClass: {new (...args: any[]): T; fromRef(ref: DocumentReference): T};

  constructor(modelClass: {new (...args: any[]): T; fromRef(ref: DocumentReference): T}) {
    this.modelClass = modelClass;
  }

  async findByRef(ref: DocumentReference): Promise<T | null> {
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return null;
    }
    return this._buildModelFromFirestoreSnapshot(snapshot);
  }

  async getByRef(modelRef: DocumentReference): Promise<T> {
    const snapshot = await modelRef.get();
    if (!snapshot.exists) {
      throw new Error(`[FirestoreRepository] Document does not exist in Firestore; path=${modelRef.path}`);
    }
    return this._buildModelFromFirestoreSnapshot(snapshot);
  }

  async getFromSnapshot(snapshot: DocumentSnapshot): Promise<T> {
    return this._buildModelFromFirestoreSnapshot(snapshot);
  }

  async findRefsByQuery(query: Query): Promise<DocumentReference[]> {
    const querySnapshot = await query.get();
    return querySnapshot.docs.map((doc) => doc.ref);
  }

  async save(model: T): Promise<void> {
    this._validateModel(model);
    await model.documentRef.set(model.toFirestoreData(true));
  }

  async delete(model: T): Promise<void> {
    this._validateModel(model);
    await admin.firestore().recursiveDelete(model.documentRef);
  }

  protected _buildModelFromFirestoreSnapshot(snapshot: DocumentSnapshot): T {
    const data = snapshot.data();
    const ModelClass = this.modelClassForSnapshotData(data);
    if (ModelClass == null) {
      throw new Error('[FirestoreRepository] modelClassForSnapshotData returned null for the class');
    }
    const model = ModelClass.fromRef(snapshot.ref);
    model.fromFirestoreSnapshot(snapshot);
    return model;
  }

  modelClassForSnapshotData(_data: any): {new (...args: any[]): T; fromRef(ref: DocumentReference): T} {
    return this.modelClass;
  }

  protected _validateModel(model: T): void {
    if (model == null) {
      throw new Error('[FirestoreRepository] model is null');
    }
    if (!(model instanceof this.modelClass)) {
      throw new Error(`[FirestoreRepository] model is not an instance of ${this.modelClass.name}`);
    }
    if (model.documentRef == null) {
      throw new Error('[FirestoreRepository] model has no documentRef');
    }
  }
}
