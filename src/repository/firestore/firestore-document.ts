import {Timestamp, DocumentReference, DocumentSnapshot} from 'firebase-admin/firestore';

export class FirestoreDocument {
  protected _documentRef: DocumentReference;
  protected _id: string;

  constructor(documentRef: DocumentReference) {
    this._documentRef = documentRef;
    this._id = documentRef.id;
  }

  get documentRef(): DocumentReference {
    return this._documentRef;
  }

  get id(): string {
    return this._id;
  }

  /**
   * Assign all properties from a Firestore snapshot to this instance.
   * @param snapshot - a Firestore DocumentSnapshot
   */
  fromFirestoreSnapshot(snapshot: DocumentSnapshot): void {
    const data = snapshot.data();
    if (!data) return;
    const properties = Object.getOwnPropertyNames(data);
    for (const property of properties) {
      const value = data[property];
      if (value !== undefined) {
        if (value instanceof Timestamp) {
          // Use 'any' cast to allow dynamic property assignment.
          (this as any)[property] = value.toDate();
        } else {
          (this as any)[property] = value;
        }
      }
    }
  }

  /**
   * Returns the list of property names that should be persisted to Firestore.
   */
  protected _getPersistentProperties(): string[] {
    const properties = Object.getOwnPropertyNames(this);
    return properties.filter((name) => !name.startsWith('_'));
  }

  /**
   * Converts this instance to a plain object suitable for storing in Firestore.
   * @param checkUndefined - if true, throws an error when a property is undefined.
   */
  toFirestoreData(checkUndefined: boolean = false): {} {
    let data: {[key: string]: any} = {};
    const persistentProperties = this._getPersistentProperties();
    data = persistentProperties.reduce((obj, property) => {
      const value = (this as any)[property];
      if (value === undefined) {
        if (checkUndefined) {
          throw new Error(`[FirestoreDocument] ${this.constructor.name}.${property} is undefined`);
        }
        return obj;
      }
      if (value instanceof Date) {
        obj[property] = Timestamp.fromDate(value);
      } else {
        obj[property] = value;
      }
      return obj;
    }, data);
    return data;
  }

  /**
   * Converts this instance to a plain object suitable for JSON serialization.
   */
  toJsonData(): {} {
    let data: {[key: string]: any} = {};
    const properties = Object.getOwnPropertyNames(this);
    const persistentProperties = properties.filter((name) => !name.startsWith('_'));
    data = persistentProperties.reduce((obj, property) => {
      const value = (this as any)[property];
      if (value !== undefined) {
        if (value instanceof Date) {
          obj[property] = value.getTime();
        } else if (value instanceof Timestamp) {
          obj[property] = value.toMillis();
        } else {
          obj[property] = value;
        }
      }
      return obj;
    }, data);
    return data;
  }
}
