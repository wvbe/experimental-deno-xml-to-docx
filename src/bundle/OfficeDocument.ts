import * as path from 'https://deno.land/std@0.146.0/path/mod.ts';

import { XmlFile } from '../classes/XmlFile.ts';
import { ZipArchive } from '../classes/ZipArchive.ts';
import type { Document as DocumentComponent } from '../components/Document.ts';
import { Paragraph } from '../components/Paragraph.ts';
import { Table } from '../components/Table.ts';
import { BundleFile, ContentType } from '../types.ts';
import { create } from '../util/dom.ts';
import { ALL_NAMESPACE_DECLARATIONS, QNS } from '../util/namespaces.ts';
import { evaluateXPathToNodes } from '../util/xquery.ts';
import { File, Relationships, RelationshipType } from './Relationships.ts';
import { Styles } from './Styles.ts';

export type OfficeDocumentChild = Paragraph | Table | DocumentComponent;

export class OfficeDocument extends XmlFile {
	public static contentType = ContentType.mainDocument;

	public readonly relationships: Relationships;
	public readonly children: OfficeDocumentChild[] = [];

	public constructor(
		location: string,
		relationships = new Relationships(
			`${path.dirname(location)}/_rels/${path.basename(location)}.rels`,
		),
		children: OfficeDocumentChild[] = [],
	) {
		super(location);
		this.relationships = relationships;
		this.children = children;

		// Some features don't work when there is no styles relationship (eg. change tracking styles).
		// However, ensuring that object exists should be the responsibity of those features.
		Object.defineProperty(this, '_styles', {
			enumerable: false,
		});
	}

	private _styles: Styles | null = null;
	public get styles() {
		// @TODO Invalidate the cached _styles whenever that relationship changes.
		if (!this._styles) {
			this._styles = this.relationships.ensureRelationship(
				RelationshipType.styles,
				() => new Styles(BundleFile.styles),
			);
		}
		return this._styles;
	}

	protected toNode(): Document {
		// @TODO look at attribute w:document@mc:Ignorable="w14 w15 w16se w16cid w16 w16cex w16sdtdh wp14"
		return create(
			`
				<w:document ${ALL_NAMESPACE_DECLARATIONS}>
					<w:body>
						{$children}
					</w:body>
				</w:document>
			`,
			{
				children: this.children.map((child) => child.toNode([this])),
			},
			true,
		);
	}

	/**
	 * Add content to the document body
	 */
	public append(children: OfficeDocumentChild | OfficeDocumentChild[]) {
		this.children.push(...(Array.isArray(children) ? children : [children]));
	}

	public set(children: OfficeDocumentChild | OfficeDocumentChild[]) {
		this.children.splice(0, this.children.length);
		this.append(children);
	}

	public getRelated(): File[] {
		return [this, ...this.relationships.getRelated()];
	}

	/**
	 * Instantiate this class by looking at the DOCX XML for it.
	 */
	public static async fromArchive(archive: ZipArchive, location: string): Promise<OfficeDocument> {
		const relationships = await Relationships.fromArchive(
			archive,
			`${path.dirname(location)}/_rels/${path.basename(location)}.rels`,
		);
		const dom = await archive.readXml(location);
		const children = evaluateXPathToNodes(`/*/${QNS.w}body/*`, dom)
			.map((node) => {
				switch (node.nodeName) {
					case 'w:p':
						return Paragraph.fromNode(node);
					case 'w:tbl':
						return Table.fromNode(node);
					default:
						return null;
				}
			})
			.filter((x): x is Exclude<typeof x, null> => Boolean(x));
		return new OfficeDocument(location, relationships, children);
	}
}
