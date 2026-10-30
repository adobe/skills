'use strict';
// Test inputs for the Branch H tests, kept in this one file instead of fixture folders.
// PROJECT_FILES is a minimal customer project (ui.apps / ui.content / all, the layout the tool scans);
// TOOL_WRITTEN and TOOL_DELETED are what wf-migrator 0.7.0 wrote and deleted when run on it, and TOOL_REPORT
// is the migration-report.md it wrote, so the follow-up and verify tests need no Java. asset-workflow-e2e.test.js (ASSET_WF_E2E=1) checks them
// against the real JAR; update them when the pinned tool version changes.
const fs = require('fs');
const os = require('os');
const path = require('path');

const SKIP = new Set(['.git', 'target']);

function listFiles(dir, base = dir, out = []) {
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) listFiles(p, base, out); } else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

function copyDir(src, dest) {
  for (const f of listFiles(src)) {
    const to = path.join(dest, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(src, f), to);
  }
  return dest;
}

function writeFiles(dest, files) {
  for (const [f, content] of Object.entries(files)) {
    const to = path.join(dest, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, content);
  }
  return dest;
}

function pruneEmptyDirs(file, stop) {
  for (let d = path.dirname(file); d.startsWith(stop) && d !== stop; d = path.dirname(d)) {
    try { if (fs.readdirSync(d).length) return; fs.rmdirSync(d); } catch { return; }
  }
}

const materializeProject = dest => writeFiles(dest, PROJECT_FILES);

function materializeToolOutput(dest) {
  writeFiles(dest, PROJECT_FILES);
  writeFiles(dest, TOOL_WRITTEN);
  for (const f of TOOL_DELETED) {
    fs.rmSync(path.join(dest, f), { force: true });
    pruneEmptyDirs(path.join(dest, f), dest);
  }
  return dest;
}

// Differences between a real tool run on a copy of the project (`rawDir`) and TOOL_WRITTEN /
// TOOL_DELETED; [] when they match.
function diffAgainstSnapshot(rawDir) {
  const after = listFiles(rawDir);
  const read = f => fs.readFileSync(path.join(rawDir, f), 'utf8');
  const written = after.filter(f => PROJECT_FILES[f] !== read(f));
  const deleted = Object.keys(PROJECT_FILES).filter(f => !after.includes(f)).sort();
  const out = [];
  for (const f of written) {
    if (TOOL_WRITTEN[f] === undefined) out.push(`tool wrote ${f}, not in TOOL_WRITTEN`);
    else if (TOOL_WRITTEN[f] !== read(f)) out.push(`${f} differs from TOOL_WRITTEN`);
  }
  for (const f of Object.keys(TOOL_WRITTEN)) if (!written.includes(f)) out.push(`TOOL_WRITTEN has ${f}, the tool did not write it`);
  if (JSON.stringify(TOOL_DELETED) !== JSON.stringify(deleted)) out.push(`deleted files differ: expected ${JSON.stringify(TOOL_DELETED)}, tool ${JSON.stringify(deleted)}`);
  return out;
}

const PROJECT_FILES = {
  'all/pom.xml': `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/maven-v4_0_0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>com.example.wfmin</groupId>
        <artifactId>wfmin</artifactId>
        <version>1.0.0-SNAPSHOT</version>
        <relativePath>../pom.xml</relativePath>
    </parent>
    <artifactId>wfmin.all</artifactId>
    <packaging>content-package</packaging>
    <name>WF Min - All</name>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.jackrabbit</groupId>
                <artifactId>filevault-package-maven-plugin</artifactId>
                <extensions>true</extensions>
                <configuration>
                    <group>com.example.wfmin</group>
                    <embeddeds>
                        <embedded>
                            <groupId>com.example.wfmin</groupId>
                            <artifactId>wfmin.ui.apps</artifactId>
                            <type>zip</type>
                            <target>/apps/wfmin-packages/application/install</target>
                        </embedded>
                        <embedded>
                            <groupId>com.example.wfmin</groupId>
                            <artifactId>wfmin.ui.content</artifactId>
                            <type>zip</type>
                            <target>/apps/wfmin-packages/content/install</target>
                        </embedded>
                    </embeddeds>
                </configuration>
            </plugin>
        </plugins>
    </build>

    <dependencies>
        <dependency>
            <groupId>com.example.wfmin</groupId>
            <artifactId>wfmin.ui.apps</artifactId>
            <version>\${project.version}</version>
            <type>zip</type>
        </dependency>
        <dependency>
            <groupId>com.example.wfmin</groupId>
            <artifactId>wfmin.ui.content</artifactId>
            <version>\${project.version}</version>
            <type>zip</type>
        </dependency>
    </dependencies>
</project>
`,
  'all/src/main/content/META-INF/vault/filter.xml': `<?xml version="1.0" encoding="UTF-8"?>
<workspaceFilter version="1.0">
    <filter root="/apps/wfmin-packages"/>
</workspaceFilter>
`,
  'pom.xml': `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Minimal AEM 6.5 project for the asset workflow migration tests. It reproduces the cases the
  skill checks after Adobe's Asset Workflow Migration Tool (wf-migrator) runs; see
  ../../../asset-workflow-followup.test.js for the expected outcome.
-->
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/maven-v4_0_0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.example.wfmin</groupId>
    <artifactId>wfmin</artifactId>
    <version>1.0.0-SNAPSHOT</version>
    <packaging>pom</packaging>
    <name>WF Min - Reactor</name>

    <modules>
        <module>ui.apps</module>
        <module>ui.content</module>
        <module>all</module>
    </modules>

    <build>
        <pluginManagement>
            <plugins>
                <plugin>
                    <groupId>org.apache.jackrabbit</groupId>
                    <artifactId>filevault-package-maven-plugin</artifactId>
                    <version>1.3.6</version>
                </plugin>
            </plugins>
        </pluginManagement>
    </build>
</project>
`,
  'ui.apps/pom.xml': `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/maven-v4_0_0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>com.example.wfmin</groupId>
        <artifactId>wfmin</artifactId>
        <version>1.0.0-SNAPSHOT</version>
        <relativePath>../pom.xml</relativePath>
    </parent>
    <artifactId>wfmin.ui.apps</artifactId>
    <packaging>content-package</packaging>
    <name>WF Min - UI apps</name>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.jackrabbit</groupId>
                <artifactId>filevault-package-maven-plugin</artifactId>
                <extensions>true</extensions>
                <configuration>
                    <group>com.example.wfmin</group>
                    <name>wfmin.ui.apps</name>
                    <packageType>application</packageType>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
`,
  'ui.apps/src/main/content/META-INF/vault/filter.xml': `<?xml version="1.0" encoding="UTF-8"?>
<workspaceFilter version="1.0">
    <filter root="/apps/wfmin"/>
</workspaceFilter>
`,
  'ui.apps/src/main/content/jcr_root/apps/wfmin/osgiconfig/config.author/com.adobe.cq.dam.processor.nui.impl.workflow.CustomDamWorkflowRunnerImpl.xml': `<?xml version="1.0" encoding="UTF-8"?>
<!-- Existing legacy XML runner config: the tool writes a second one with the same PID. -->
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="sling:OsgiConfig"
    postProcWorkflowsByPath="[/content/dam/wfmin/brand:/var/workflow/models/wfmin-brand]"/>
`,
  'ui.content/pom.xml': `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/maven-v4_0_0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>com.example.wfmin</groupId>
        <artifactId>wfmin</artifactId>
        <version>1.0.0-SNAPSHOT</version>
        <relativePath>../pom.xml</relativePath>
    </parent>
    <artifactId>wfmin.ui.content</artifactId>
    <packaging>content-package</packaging>
    <name>WF Min - UI content</name>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.jackrabbit</groupId>
                <artifactId>filevault-package-maven-plugin</artifactId>
                <extensions>true</extensions>
                <configuration>
                    <group>com.example.wfmin</group>
                    <name>wfmin.ui.content</name>
                    <packageType>content</packageType>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
`,
  'ui.content/src/main/content/META-INF/vault/filter.xml': `<?xml version="1.0" encoding="UTF-8"?>
<!-- Packaging /var/workflow is what the tool (and the gate) removes. -->
<workspaceFilter version="1.0">
    <filter root="/conf/global/settings/workflow"/>
    <filter root="/var/workflow/models" mode="merge"/>
</workspaceFilter>
`,
  'ui.content/src/main/content/jcr_root/conf/global/settings/workflow/launcher/config/update_asset_create/.content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:WorkflowLauncher"
    condition=""
    conditions="[jcr:content/jcr:mimeType!=video/.*]"
    description="Update Asset - Create"
    enabled="{Boolean}true"
    eventType="{Long}1"
    excludeList="event-user-data:changedByWorkflowProcess"
    glob="/content/dam/wfmin(/.*/)renditions/original"
    nodetype="nt:file"
    runModes="author"
    workflow="/var/workflow/models/dam/update_asset"/>
`,
  'ui.content/src/main/content/jcr_root/conf/global/settings/workflow/launcher/config/update_asset_mod/.content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:WorkflowLauncher"
    condition=""
    conditions="[jcr:content/jcr:mimeType!=video/.*]"
    description="Update Asset - Modification"
    enabled="{Boolean}true"
    eventType="{Long}16"
    excludeList="event-user-data:changedByWorkflowProcess"
    glob="/content/dam/wfmin(/.*/)renditions/original"
    nodetype="nt:file"
    runModes="author"
    workflow="/var/workflow/models/dam/update_asset"/>
`,
  'ui.content/src/main/content/jcr_root/conf/global/settings/workflow/launcher/config/wfmin-campaigns/.content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:WorkflowLauncher"
    condition=""
    conditions="[]"
    description="WF Min campaign and event assets"
    enabled="{Boolean}true"
    eventType="{Long}1"
    excludeList="event-user-data:changedByWorkflowProcess"
    glob="/content/dam/(wfmin-campaigns|wfmin-events)/.*/renditions/original"
    nodetype="nt:file"
    runModes="author"
    workflow="/var/workflow/models/wfmin-campaigns"/>
`,
  'ui.content/src/main/content/jcr_root/conf/global/settings/workflow/launcher/config/wfmin-marketing/.content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:WorkflowLauncher"
    condition=""
    conditions="[]"
    description="WF Min marketing assets"
    enabled="{Boolean}true"
    eventType="{Long}1"
    excludeList="event-user-data:changedByWorkflowProcess"
    glob="/content/dam/wfmin/marketing(/.*/)renditions/original"
    nodetype="nt:file"
    runModes="author"
    workflow="/var/workflow/models/wfmin-marketing"/>
`,
  'ui.content/src/main/content/jcr_root/conf/global/settings/workflow/models/dam/update_asset/.content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<!-- Overlaid OOTB model. Completed is not last; CommandLineProcess is UNSUPPORTED
     with one standard thumbnail, one mappable rendition and one that needs a custom worker. -->
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="cq:Page">
    <jcr:content
        cq:template="/libs/cq/workflow/templates/model"
        jcr:primaryType="cq:PageContent"
        jcr:title="DAM Update Asset"
        sling:resourceType="cq/workflow/components/pages/model"
        transient="true">
        <flow
            jcr:primaryType="nt:unstructured"
            sling:resourceType="foundation/components/parsys">
            <metadataprocessor
                jcr:primaryType="nt:unstructured"
                jcr:title="Metadata Processor"
                sling:resourceType="cq/workflow/components/model/process">
                <metaData
                    jcr:primaryType="nt:unstructured"
                    PROCESS="com.day.cq.dam.core.process.MetadataProcessorProcess"
                    PROCESS_AUTO_ADVANCE="true"/>
            </metadataprocessor>
            <thumbnailprocess
                jcr:primaryType="nt:unstructured"
                jcr:title="Process Thumbnails"
                sling:resourceType="cq/workflow/components/model/process">
                <metaData
                    jcr:primaryType="nt:unstructured"
                    PROCESS="com.day.cq.dam.core.process.ThumbnailProcess"
                    PROCESS_ARGS="[48:48],[140:100],[319:319],[600:600]"
                    PROCESS_AUTO_ADVANCE="true"/>
            </thumbnailprocess>
            <commandlineprocess
                jcr:primaryType="nt:unstructured"
                jcr:title="Print renditions (ImageMagick)"
                sling:resourceType="dam/components/workflow/commandlineprocess"
                PROCESS="com.day.cq.dam.core.process.CommandLineProcess"
                PROCESS_AUTO_ADVANCE="true">
                <metaData
                    jcr:primaryType="nt:unstructured"
                    COMMANDS="[convert \${filename} -thumbnail 319x319 cq5dam.thumbnail.319.319.png,convert \${filename} -resize 1200x1200 cq5dam.print.1200.1200.jpeg,convert -resize 25% \${filename} cq5dam.preview-25.png]"
                    MIME_TYPES="[image/tiff,image/png]"
                    PROCESS="com.day.cq.dam.core.process.CommandLineProcess"
                    PROCESS_AUTO_ADVANCE="true"/>
            </commandlineprocess>
            <damupdateassetworkflowcompletedprocess
                jcr:primaryType="nt:unstructured"
                jcr:title="DAM Update Asset Workflow Completed"
                sling:resourceType="dam/components/workflow/damupdateassetworkflowcompletedprocess">
                <metaData
                    jcr:primaryType="nt:unstructured"
                    PROCESS="com.day.cq.dam.core.impl.process.DamUpdateAssetWorkflowCompletedProcess"
                    PROCESS_AUTO_ADVANCE="true"/>
            </damupdateassetworkflowcompletedprocess>
            <watermark
                jcr:primaryType="nt:unstructured"
                jcr:title="Watermark"
                sling:resourceType="cq/workflow/components/model/process">
                <metaData
                    jcr:primaryType="nt:unstructured"
                    PROCESS="com.example.wfmin.core.workflow.WatermarkProcess"
                    PROCESS_AUTO_ADVANCE="true"/>
            </watermark>
        </flow>
    </jcr:content>
</jcr:root>
`,
  'ui.content/src/main/content/jcr_root/conf/global/settings/workflow/models/wfmin-campaigns/.content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<!-- Custom model whose only real work is inside an AND split: the tool disables its launcher but
     does not wire it. Non-transient on purpose. -->
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="cq:Page">
    <jcr:content
        cq:template="/libs/cq/workflow/templates/model"
        jcr:primaryType="cq:PageContent"
        jcr:title="WF Min Campaigns"
        sling:resourceType="cq/workflow/components/pages/model"
        transient="false">
        <flow
            jcr:primaryType="nt:unstructured"
            sling:resourceType="foundation/components/parsys">
            <and
                jcr:primaryType="nt:unstructured"
                jcr:title="Tag and gate"
                sling:resourceType="cq/workflow/components/model/and"
                branches="2">
                <_x0031_
                    jcr:primaryType="nt:unstructured"
                    sling:resourceType="cq/flow/components/parsys">
                    <tagbyfolder
                        jcr:primaryType="nt:unstructured"
                        jcr:title="Tag by folder"
                        sling:resourceType="cq/workflow/components/model/process">
                        <metaData
                            jcr:primaryType="nt:unstructured"
                            PROCESS="com.example.wfmin.core.workflow.TagByFolderProcess"
                            PROCESS_AUTO_ADVANCE="true"/>
                    </tagbyfolder>
                </_x0031_>
                <_x0032_
                    jcr:primaryType="nt:unstructured"
                    sling:resourceType="cq/flow/components/parsys">
                    <gatekeeper
                        jcr:primaryType="nt:unstructured"
                        jcr:title="Gate keeper"
                        sling:resourceType="cq/workflow/components/model/process">
                        <metaData
                            jcr:primaryType="nt:unstructured"
                            PROCESS="com.day.cq.dam.core.process.GateKeeperProcess"
                            PROCESS_AUTO_ADVANCE="true"/>
                    </gatekeeper>
                </_x0032_>
            </and>
        </flow>
    </jcr:content>
</jcr:root>
`,
  'ui.content/src/main/content/jcr_root/conf/global/settings/workflow/models/wfmin-marketing/.content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<!-- Custom model. The OR split holds only Dynamic Media (DMS7_OOTB) and a noop branch, so it has no
     work left; there is no Completed step. -->
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="cq:Page">
    <jcr:content
        cq:template="/libs/cq/workflow/templates/model"
        jcr:primaryType="cq:PageContent"
        jcr:title="WF Min Marketing"
        sling:resourceType="cq/workflow/components/pages/model"
        transient="true">
        <flow
            jcr:primaryType="nt:unstructured"
            sling:resourceType="foundation/components/parsys">
            <or
                jcr:primaryType="nt:unstructured"
                jcr:title="Upload to Scene7?"
                sling:resourceType="cq/workflow/components/model/or"
                branches="2"
                orSplit="true"
                script1="function check() {&#xd;&#xa;    return workflowData.getPayload().toString().indexOf(&quot;/s7/&quot;) > -1;&#xd;&#xa;}"
                script2="function check() {&#xd;&#xa;    return true;&#xd;&#xa;}">
                <_x0031_
                    jcr:primaryType="nt:unstructured"
                    sling:resourceType="cq/flow/components/parsys">
                    <scene7upload
                        jcr:primaryType="nt:unstructured"
                        jcr:title="Scene7"
                        sling:resourceType="dam/components/scene7/scene7upload">
                        <metaData
                            jcr:primaryType="nt:unstructured"
                            EXTERNAL_PROCESS="com.day.cq.dam.scene7.impl.process.Scene7UploadProcess"
                            PROCESS_AUTO_ADVANCE="true"/>
                    </scene7upload>
                </_x0031_>
                <_x0032_
                    jcr:primaryType="nt:unstructured"
                    sling:resourceType="cq/flow/components/parsys">
                    <noop
                        jcr:primaryType="nt:unstructured"
                        jcr:title="No operation"
                        sling:resourceType="cq/workflow/components/model/process">
                        <metaData
                            jcr:primaryType="nt:unstructured"
                            PROCESS="/libs/workflow/scripts/noop.ecma"
                            PROCESS_AUTO_ADVANCE="true"/>
                    </noop>
                </_x0032_>
            </or>
            <autopublish
                jcr:primaryType="nt:unstructured"
                jcr:title="Auto publish"
                sling:resourceType="cq/workflow/components/model/process">
                <metaData
                    jcr:primaryType="nt:unstructured"
                    PROCESS="com.example.wfmin.core.workflow.AutoPublishProcess"
                    PROCESS_AUTO_ADVANCE="true"/>
            </autopublish>
        </flow>
    </jcr:content>
</jcr:root>
`,
  'ui.content/src/main/content/jcr_root/var/workflow/models/dam/update_asset.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:WorkflowModel"
    sling:resourceType="cq/workflow/components/model"
    title="DAM Update Asset">
    <metaData
        cq:generatingPage="/conf/global/settings/workflow/models/dam/update_asset/jcr:content"
        jcr:primaryType="nt:unstructured"/>
    <nodes jcr:primaryType="nt:unstructured">
        <node0
            jcr:primaryType="cq:WorkflowNode"
            title="Start"
            type="START">
            <metaData jcr:primaryType="nt:unstructured"/>
        </node0>
        <node1
            jcr:primaryType="cq:WorkflowNode"
            title="End"
            type="END">
            <metaData jcr:primaryType="nt:unstructured"/>
        </node1>
    </nodes>
    <transitions jcr:primaryType="nt:unstructured">
        <node0_x0023_node1
            jcr:primaryType="cq:WorkflowTransition"
            from="node0"
            rule=""
            to="node1">
            <metaData jcr:primaryType="nt:unstructured"/>
        </node0_x0023_node1>
    </transitions>
</jcr:root>
`,
  'ui.content/src/main/content/jcr_root/var/workflow/models/wfmin-campaigns.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:WorkflowModel"
    sling:resourceType="cq/workflow/components/model"
    title="WF Min Campaigns">
    <metaData
        cq:generatingPage="/conf/global/settings/workflow/models/wfmin-campaigns/jcr:content"
        jcr:primaryType="nt:unstructured"/>
    <nodes jcr:primaryType="nt:unstructured">
        <node0
            jcr:primaryType="cq:WorkflowNode"
            title="Start"
            type="START">
            <metaData jcr:primaryType="nt:unstructured"/>
        </node0>
        <node1
            jcr:primaryType="cq:WorkflowNode"
            title="End"
            type="END">
            <metaData jcr:primaryType="nt:unstructured"/>
        </node1>
    </nodes>
    <transitions jcr:primaryType="nt:unstructured">
        <node0_x0023_node1
            jcr:primaryType="cq:WorkflowTransition"
            from="node0"
            rule=""
            to="node1">
            <metaData jcr:primaryType="nt:unstructured"/>
        </node0_x0023_node1>
    </transitions>
</jcr:root>
`,
  'ui.content/src/main/content/jcr_root/var/workflow/models/wfmin-legacy.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:WorkflowModel"
    sling:resourceType="cq/workflow/components/model"
    title="WF Min Legacy">
    <metaData
        cq:generatingPage="/etc/workflow/models/wfmin-legacy/jcr:content"
        jcr:primaryType="nt:unstructured"/>
    <nodes jcr:primaryType="nt:unstructured">
        <node0
            jcr:primaryType="cq:WorkflowNode"
            title="Start"
            type="START">
            <metaData jcr:primaryType="nt:unstructured"/>
        </node0>
        <node1
            jcr:primaryType="cq:WorkflowNode"
            title="End"
            type="END">
            <metaData jcr:primaryType="nt:unstructured"/>
        </node1>
    </nodes>
    <transitions jcr:primaryType="nt:unstructured">
        <node0_x0023_node1
            jcr:primaryType="cq:WorkflowTransition"
            from="node0"
            rule=""
            to="node1">
            <metaData jcr:primaryType="nt:unstructured"/>
        </node0_x0023_node1>
    </transitions>
</jcr:root>
`,
  'ui.content/src/main/content/jcr_root/var/workflow/models/wfmin-marketing.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:WorkflowModel"
    sling:resourceType="cq/workflow/components/model"
    title="WF Min Marketing">
    <metaData
        cq:generatingPage="/conf/global/settings/workflow/models/wfmin-marketing/jcr:content"
        jcr:primaryType="nt:unstructured"/>
    <nodes jcr:primaryType="nt:unstructured">
        <node0
            jcr:primaryType="cq:WorkflowNode"
            title="Start"
            type="START">
            <metaData jcr:primaryType="nt:unstructured"/>
        </node0>
        <node1
            jcr:primaryType="cq:WorkflowNode"
            title="End"
            type="END">
            <metaData jcr:primaryType="nt:unstructured"/>
        </node1>
    </nodes>
    <transitions jcr:primaryType="nt:unstructured">
        <node0_x0023_node1
            jcr:primaryType="cq:WorkflowTransition"
            from="node0"
            rule=""
            to="node1">
            <metaData jcr:primaryType="nt:unstructured"/>
        </node0_x0023_node1>
    </transitions>
</jcr:root>
`,
};

const TOOL_WRITTEN = {
  'aem-cloud-migration.apps/pom.xml': `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/maven-v4_0_0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>com.example.wfmin</groupId>
        <artifactId>wfmin</artifactId>
        <version>1.0.0-SNAPSHOT</version>
        <relativePath>../pom.xml</relativePath>
    </parent>

    <artifactId>aem-cloud-migration.apps</artifactId>
    <packaging>content-package</packaging>
    <name>AEM in the Cloud Migration - Apps Project</name>
    <description>Contains immutable content nodes generated by the aem-cloud-migration tool</description>

    <build>
        <sourceDirectory>src/main/content/jcr_root</sourceDirectory>
        <plugins>
            <plugin>
                <groupId>org.apache.jackrabbit</groupId>
                <artifactId>filevault-package-maven-plugin</artifactId>
                <extensions>true</extensions>
                <configuration>
                    <group>aem-cloud-migration</group>
                    <name>migration-apps</name>
                    <packageType>container</packageType>
                    <properties>
                        <cloudManagerTarget>none</cloudManagerTarget>
                    </properties>
                </configuration>
            </plugin>
            <plugin>
                <groupId>com.day.jcr.vault</groupId>
                <artifactId>content-package-maven-plugin</artifactId>
                <extensions>true</extensions>
                <configuration>
                    <verbose>true</verbose>
                    <failOnError>true</failOnError>
                </configuration>
            </plugin>
        </plugins>
    </build>

</project>
`,
  'aem-cloud-migration.apps/src/main/content/META-INF/vault/filter.xml': `<?xml version="1.0" encoding="UTF-8"?>
<workspaceFilter version="1.0">
    <filter root="/apps/aem-cloud-migration"/>
    <filter root="/apps/aem-cloud-migration/config.author"/>
</workspaceFilter>
`,
  'aem-cloud-migration.apps/src/main/content/jcr_root/apps/aem-cloud-migration/config.author/com.adobe.cq.dam.processor.nui.impl.workflow.CustomDamWorkflowRunnerImpl.cfg.json': `{
  "postProcWorkflowsByPath": [
    "/content/dam/wfmin/brand:/var/workflow/models/wfmin-brand"
  ],
  "postProcWorkflowsByExpression": [
    "/content/dam/(wfmin-campaigns|wfmin-events)/.*:/var/workflow/models/wfmin-campaigns",
    "/content/dam/wfmin(/.*):/var/workflow/models/dam/update_asset",
    "/content/dam/wfmin/marketing(/.*):/var/workflow/models/wfmin-marketing"
  ]
}
`,
  'aem-cloud-migration.content/pom.xml': `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/maven-v4_0_0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>com.example.wfmin</groupId>
        <artifactId>wfmin</artifactId>
        <version>1.0.0-SNAPSHOT</version>
        <relativePath>../pom.xml</relativePath>
    </parent>

    <artifactId>aem-cloud-migration.content</artifactId>
    <packaging>content-package</packaging>
    <name>AEM in the Cloud Migration - Content Project</name>
    <description>Contains mutable content nodes generated by the aem-cloud-migration tool</description>

    <build>
        <sourceDirectory>src/main/content/jcr_root</sourceDirectory>
        <plugins>
            <plugin>
                <groupId>org.apache.jackrabbit</groupId>
                <artifactId>filevault-package-maven-plugin</artifactId>
                <extensions>true</extensions>
                <configuration>
                    <group>aem-cloud-migration</group>
                    <name>migration-content</name>
                    <packageType>content</packageType>
                    <properties>
                        <cloudManagerTarget>none</cloudManagerTarget>
                    </properties>
                </configuration>
            </plugin>
            <plugin>
                <groupId>com.day.jcr.vault</groupId>
                <artifactId>content-package-maven-plugin</artifactId>
                <extensions>true</extensions>
                <configuration>
                    <verbose>true</verbose>
                    <failOnError>true</failOnError>
                </configuration>
            </plugin>
        </plugins>
    </build>

</project>
`,
  'aem-cloud-migration.content/src/main/content/META-INF/vault/filter.xml': `<?xml version="1.0" encoding="UTF-8"?>
<workspaceFilter version="1.0">
    <filter root="/conf/global/settings/dam/processing/jcr:content"/>
    <filter root="/conf/global/settings/dam/processing/migrated_from_update_asset"/>
</workspaceFilter>
`,
  'aem-cloud-migration.content/src/main/content/jcr_root/conf/global/settings/dam/.content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:Page">
    <processing/>
    <processingOFF/>
</jcr:root>
`,
  'aem-cloud-migration.content/src/main/content/jcr_root/conf/global/settings/dam/processing/.content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="cq:Page">
    <jcr:content
        jcr:primaryType="nt:unstructured"
        mergeList="{Boolean}true"/>
</jcr:root>
`,
  'aem-cloud-migration.content/src/main/content/jcr_root/conf/global/settings/dam/processing/migrated_from_update_asset/.content.xml': `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0" jcr:primaryType="cq:Page">
    <jcr:content jcr:primaryType="nt:unstructured" jcr:title="Migrated from update_asset" sling:resourceType="dam/processing/profile"/>
</jcr:root>
`,
  'aem-cloud-migration.content/src/main/content/jcr_root/conf/global/settings/dam/processing/migrated_from_update_asset/cq5dam_print_1200_1200/.content.xml': `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0" jcr:primaryType="cq:Page">
    <jcr:content excludeMimeTypes="video/.*" fmt="jpeg" hei="1200" includeMimeTypes="image/png,image/tiff" jcr:primaryType="nt:unstructured" name="cq5dam.print.1200.1200.jpeg" sling:resourceType="dam/processing/profile/rendition" wid="1200"/>
</jcr:root>
`,
  'aem-cloud-migration.content/src/main/content/jcr_root/conf/global/settings/dam/processing/migrated_from_update_asset/thumbnail/.content.xml': `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0" jcr:primaryType="cq:Page">
    <jcr:content excludeMimeTypes="video/.*" fmt="png" hei="600" includeMimeTypes="image/.*" jcr:primaryType="nt:unstructured" name="cq5dam.thumbnail.600.600.png" sling:resourceType="dam/processing/profile/rendition" wid="600"/>
</jcr:root>
`,
  'all/pom.xml': `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/maven-v4_0_0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>com.example.wfmin</groupId>
        <artifactId>wfmin</artifactId>
        <version>1.0.0-SNAPSHOT</version>
        <relativePath>../pom.xml</relativePath>
    </parent>
    <artifactId>wfmin.all</artifactId>
    <packaging>content-package</packaging>
    <name>WF Min - All</name>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.jackrabbit</groupId>
                <artifactId>filevault-package-maven-plugin</artifactId>
                <extensions>true</extensions>
                <configuration>
                    <group>com.example.wfmin</group>
                    <embeddeds>
                        <embedded>
                            <groupId>com.example.wfmin</groupId>
                            <artifactId>wfmin.ui.apps</artifactId>
                            <type>zip</type>
                            <target>/apps/wfmin-packages/application/install</target>
                        </embedded>
                        <embedded>
                            <groupId>com.example.wfmin</groupId>
                            <artifactId>wfmin.ui.content</artifactId>
                            <type>zip</type>
                            <target>/apps/wfmin-packages/content/install</target>
                        </embedded>
                        <embedded>
                            <groupId>com.example.wfmin</groupId>
                            <artifactId>aem-cloud-migration.content</artifactId>
                            <type>zip</type>
                            <target>/apps/aem-cloud-migration-packages/content/install</target>
                        </embedded>
                        <embedded>
                            <groupId>com.example.wfmin</groupId>
                            <artifactId>aem-cloud-migration.apps</artifactId>
                            <type>zip</type>
                            <target>/apps/aem-cloud-migration-packages/application/install</target>
                        </embedded>
                    </embeddeds>
                </configuration>
            </plugin>
        </plugins>
    </build>

    <dependencies>
        <dependency>
            <groupId>com.example.wfmin</groupId>
            <artifactId>wfmin.ui.apps</artifactId>
            <version>\${project.version}</version>
            <type>zip</type>
        </dependency>
        <dependency>
            <groupId>com.example.wfmin</groupId>
            <artifactId>wfmin.ui.content</artifactId>
            <version>\${project.version}</version>
            <type>zip</type>
        </dependency>
        <dependency>
            <groupId>com.example.wfmin</groupId>
            <artifactId>aem-cloud-migration.content</artifactId>
            <version>\${project.version}</version>
            <type>zip</type>
        </dependency>
        <dependency>
            <groupId>com.example.wfmin</groupId>
            <artifactId>aem-cloud-migration.apps</artifactId>
            <version>\${project.version}</version>
            <type>zip</type>
        </dependency>
    </dependencies>
</project>
`,
  'all/src/main/content/META-INF/vault/filter.xml': `<?xml version="1.0" encoding="UTF-8"?>
<workspaceFilter version="1.0">
    <filter root="/apps/wfmin-packages"/>
    <filter root="/apps/aem-cloud-migration-packages"/>
</workspaceFilter>
`,
  'pom.xml': `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Minimal AEM 6.5 project for the asset workflow migration tests. It reproduces the cases the
  skill checks after Adobe's Asset Workflow Migration Tool (wf-migrator) runs; see
  ../../../asset-workflow-followup.test.js for the expected outcome.
-->
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/maven-v4_0_0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.example.wfmin</groupId>
    <artifactId>wfmin</artifactId>
    <version>1.0.0-SNAPSHOT</version>
    <packaging>pom</packaging>
    <name>WF Min - Reactor</name>

    <modules>
        <module>ui.apps</module>
        <module>ui.content</module>
        <module>all</module>
        <module>aem-cloud-migration.content</module>
        <module>aem-cloud-migration.apps</module>
    </modules>

    <build>
        <pluginManagement>
            <plugins>
                <plugin>
                    <groupId>org.apache.jackrabbit</groupId>
                    <artifactId>filevault-package-maven-plugin</artifactId>
                    <version>1.3.6</version>
                </plugin>
            </plugins>
        </pluginManagement>
    </build>
</project>
`,
  'ui.content/src/main/content/META-INF/vault/filter.xml': `<?xml version="1.0" encoding="UTF-8"?>
<!-- Packaging /var/workflow is what the tool (and the gate) removes. -->
<workspaceFilter version="1.0">
    <filter root="/conf/global/settings/workflow"/>
</workspaceFilter>
`,
  'ui.content/src/main/content/jcr_root/conf/global/settings/workflow/launcher/config/update_asset_create/.content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:WorkflowLauncher"
    condition=""
    conditions="[jcr:content/jcr:mimeType!=video/.*]"
    description="Update Asset - Create"
    enabled="{Boolean}false"
    eventType="{Long}1"
    excludeList="event-user-data:changedByWorkflowProcess"
    glob="/content/dam/wfmin(/.*/)renditions/original"
    nodetype="nt:file"
    runModes="author"
    workflow="/var/workflow/models/dam/update_asset"/>
`,
  'ui.content/src/main/content/jcr_root/conf/global/settings/workflow/launcher/config/update_asset_mod/.content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:WorkflowLauncher"
    condition=""
    conditions="[jcr:content/jcr:mimeType!=video/.*]"
    description="Update Asset - Modification"
    enabled="{Boolean}false"
    eventType="{Long}16"
    excludeList="event-user-data:changedByWorkflowProcess"
    glob="/content/dam/wfmin(/.*/)renditions/original"
    nodetype="nt:file"
    runModes="author"
    workflow="/var/workflow/models/dam/update_asset"/>
`,
  'ui.content/src/main/content/jcr_root/conf/global/settings/workflow/launcher/config/wfmin-campaigns/.content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:WorkflowLauncher"
    condition=""
    conditions="[]"
    description="WF Min campaign and event assets"
    enabled="{Boolean}false"
    eventType="{Long}1"
    excludeList="event-user-data:changedByWorkflowProcess"
    glob="/content/dam/(wfmin-campaigns|wfmin-events)/.*/renditions/original"
    nodetype="nt:file"
    runModes="author"
    workflow="/var/workflow/models/wfmin-campaigns"/>
`,
  'ui.content/src/main/content/jcr_root/conf/global/settings/workflow/launcher/config/wfmin-marketing/.content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:WorkflowLauncher"
    condition=""
    conditions="[]"
    description="WF Min marketing assets"
    enabled="{Boolean}false"
    eventType="{Long}1"
    excludeList="event-user-data:changedByWorkflowProcess"
    glob="/content/dam/wfmin/marketing(/.*/)renditions/original"
    nodetype="nt:file"
    runModes="author"
    workflow="/var/workflow/models/wfmin-marketing"/>
`,
  'ui.content/src/main/content/jcr_root/conf/global/settings/workflow/models/dam/update_asset/.content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<!-- Overlaid OOTB model. Completed is not last; CommandLineProcess is UNSUPPORTED
     with one standard thumbnail, one mappable rendition and one that needs a custom worker. -->
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="cq:Page">
    <jcr:content
        cq:template="/libs/cq/workflow/templates/model"
        jcr:primaryType="cq:PageContent"
        jcr:title="DAM Update Asset"
        sling:resourceType="cq/workflow/components/pages/model"
        transient="true">
        <flow
            jcr:primaryType="nt:unstructured"
            sling:resourceType="foundation/components/parsys">
            <watermark
                jcr:primaryType="nt:unstructured"
                jcr:title="Watermark"
                sling:resourceType="cq/workflow/components/model/process">
                <metaData
                    jcr:primaryType="nt:unstructured"
                    PROCESS="com.example.wfmin.core.workflow.WatermarkProcess"
                    PROCESS_AUTO_ADVANCE="true"/>
            </watermark>
            <damupdateassetworkflowcompletedprocess
                jcr:primaryType="nt:unstructured"
                jcr:title="DAM Update Asset Workflow Completed"
                sling:resourceType="dam/components/workflow/damupdateassetworkflowcompletedprocess">
                <metaData
                    jcr:primaryType="nt:unstructured"
                    PROCESS="com.day.cq.dam.core.impl.process.DamUpdateAssetWorkflowCompletedProcess"
                    PROCESS_AUTO_ADVANCE="true"/>
            </damupdateassetworkflowcompletedprocess>
        </flow>
    </jcr:content>
</jcr:root>
`,
  'ui.content/src/main/content/jcr_root/conf/global/settings/workflow/models/wfmin-campaigns/.content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<!-- Custom model whose only real work is inside an AND split: the tool disables its launcher but
     does not wire it. Non-transient on purpose. -->
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="cq:Page">
    <jcr:content
        cq:template="/libs/cq/workflow/templates/model"
        jcr:primaryType="cq:PageContent"
        jcr:title="WF Min Campaigns"
        sling:resourceType="cq/workflow/components/pages/model"
        transient="false">
        <flow
            jcr:primaryType="nt:unstructured"
            sling:resourceType="foundation/components/parsys">
            <and
                jcr:primaryType="nt:unstructured"
                jcr:title="Tag and gate"
                sling:resourceType="cq/workflow/components/model/and"
                branches="2">
                <_x0031_
                    jcr:primaryType="nt:unstructured"
                    sling:resourceType="cq/flow/components/parsys">
                    <tagbyfolder
                        jcr:primaryType="nt:unstructured"
                        jcr:title="Tag by folder"
                        sling:resourceType="cq/workflow/components/model/process">
                        <metaData
                            jcr:primaryType="nt:unstructured"
                            PROCESS="com.example.wfmin.core.workflow.TagByFolderProcess"
                            PROCESS_AUTO_ADVANCE="true"/>
                    </tagbyfolder>
                </_x0031_>
                <_x0032_
                    jcr:primaryType="nt:unstructured"
                    sling:resourceType="cq/flow/components/parsys">
                    <noopprocess jcr:primaryType="nt:unstructured" jcr:title="No Operation" sling:resourceType="cq/workflow/components/workflow/noopprocess">
                        <metaData PROCESS="/libs/workflow/scripts/noop.ecma" PROCESS_AUTO_ADVANCE="true" jcr:primaryType="nt:unstructured"/>
                    </noopprocess>
                </_x0032_>
            </and>
            <damupdateassetworkflowcompletedprocess jcr:description="This process will send DamEvent.Type.DAM_UPDATE_ASSET_WORKFLOW_COMPLETED event when DAM update asset workflow is completed" jcr:primaryType="nt:unstructured" jcr:title="DAM Update Asset Workflow Completed" sling:resourceType="dam/components/workflow/damupdateassetworkflowcompletedprocess">
                <metaData PROCESS="com.day.cq.dam.core.impl.process.DamUpdateAssetWorkflowCompletedProcess" PROCESS_AUTO_ADVANCE="true" jcr:primaryType="nt:unstructured"/>
            </damupdateassetworkflowcompletedprocess>
        </flow>
    </jcr:content>
</jcr:root>
`,
  'ui.content/src/main/content/jcr_root/conf/global/settings/workflow/models/wfmin-marketing/.content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<!-- Custom model. The OR split holds only Dynamic Media (DMS7_OOTB) and a noop branch, so it has no
     work left; there is no Completed step. -->
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="cq:Page">
    <jcr:content
        cq:template="/libs/cq/workflow/templates/model"
        jcr:primaryType="cq:PageContent"
        jcr:title="WF Min Marketing"
        sling:resourceType="cq/workflow/components/pages/model"
        transient="true">
        <flow
            jcr:primaryType="nt:unstructured"
            sling:resourceType="foundation/components/parsys">
            <autopublish
                jcr:primaryType="nt:unstructured"
                jcr:title="Auto publish"
                sling:resourceType="cq/workflow/components/model/process">
                <metaData
                    jcr:primaryType="nt:unstructured"
                    PROCESS="com.example.wfmin.core.workflow.AutoPublishProcess"
                    PROCESS_AUTO_ADVANCE="true"/>
            </autopublish>
            <damupdateassetworkflowcompletedprocess jcr:description="This process will send DamEvent.Type.DAM_UPDATE_ASSET_WORKFLOW_COMPLETED event when DAM update asset workflow is completed" jcr:primaryType="nt:unstructured" jcr:title="DAM Update Asset Workflow Completed" sling:resourceType="dam/components/workflow/damupdateassetworkflowcompletedprocess">
                <metaData PROCESS="com.day.cq.dam.core.impl.process.DamUpdateAssetWorkflowCompletedProcess" PROCESS_AUTO_ADVANCE="true" jcr:primaryType="nt:unstructured"/>
            </damupdateassetworkflowcompletedprocess>
        </flow>
    </jcr:content>
</jcr:root>
`,
};

const TOOL_DELETED = [
  'ui.apps/src/main/content/jcr_root/apps/wfmin/osgiconfig/config.author/com.adobe.cq.dam.processor.nui.impl.workflow.CustomDamWorkflowRunnerImpl.xml',
  'ui.content/src/main/content/jcr_root/var/workflow/models/dam/update_asset.xml',
  'ui.content/src/main/content/jcr_root/var/workflow/models/wfmin-campaigns.xml',
  'ui.content/src/main/content/jcr_root/var/workflow/models/wfmin-legacy.xml',
  'ui.content/src/main/content/jcr_root/var/workflow/models/wfmin-marketing.xml'
];

// The tool's migration-report.md for the same run.
const TOOL_REPORT = [
  "# AEM Assets as a Cloud Service - Workflow Migration Report\n",
  "This report contains the changes that have been made to your Maven project by the workflow migration tool.  After reviewing these changes, you should be able to simply run a `mvn clean install` command against your reactor POM file to build your project with these changes in place.  After validating these changes on a local developer environment, check these changes into your source control repository and run a Cloud Manager build to deploy these changes to your AEM in the Cloud environments.\n",
  "\n",
  "## Maven Projects Added and Modified\n",
  "Changes to your workflow models and launchers have been made in-place.  We have also added the following new Maven projects:\n",
  "\n",
  "| Action | Project |\n",
  "| ------ | ------- |\n",
  "| Created | aem-cloud-migration.content |\n",
  "| Created | aem-cloud-migration.apps |\n",
  "\n",
  "These projects have been added as modules to your reactor POM.  If you have already migrated your Maven projects to the new mutable/immutable content structures, we have also added these projects to embedded packages and dependencies in your project's container content package.\n",
  "\n",
  "If you have not yet migrated your Maven projects to this new paradigm or are unsure what this means, please see [Understand the Structure of a Project Content Package in Adobe Experience Manager Cloud Service](https://docs.adobe.com/content/help/en/experience-manager-cloud-service/implementing/developing/aem-project-content-package-structure.html) for more information.\n",
  "\n",
  "## Workflow Launchers\n",
  "We have disabled some workflow launchers.  Depending on your source code, these will either be located under `/conf/global/settings/workflow/launcher/config` or `/etc/workflow/launcher/config`.  The Asset Compute Service will handle most asset processing in the cloud and any remaining custom workflow steps to be executed will be handled via the Custom Workflow Runner service.  We have disabled the following launchers:\n",
  "\n",
  "| Action | Launcher |\n",
  "| ------ | -------- |\n",
  "| Disabled | `wfmin-campaigns` |\n",
  "| Disabled | `update_asset_mod` |\n",
  "| Disabled | `update_asset_create` |\n",
  "| Disabled | `wfmin-marketing` |\n",
  "\n",
  "Note that in AEM Assets as a Cloud Service environments, out-of-the-box workflow launchers for DAM Update Asset and DAM Metadata Writeback workflows are disabled by default.\n",
  "\n",
  "## Custom Workflow Runner configuration\n",
  "We have created an author configuration for the Custom Workflow Runner service in the `aem-cloud-migration.apps` project, at `/apps/aem-cloud-migration/config.author/com.adobe.cq.dam.processor.nui.impl.workflow.CustomDamWorkflowRunnerImpl.cfg.json`.  This service replaces the role of traditional workflow launchers for asset processing workflows in AEM Assets as a Cloud Service deployments.  Since the Asset Compute Service will be processing all of our image renditions, we can no longer rely on a simple JCR event to execute our workflows.  Instead, this service will be invoked when the Asset Compute Service has completed processing and the assets are ready for custom steps to be executed against them.  If you use Dynamic Media, note that we will upload assets to Dynamic Media before executing these workflows.  We have configured the following workflows:\n",
  "\n",
  "| Action | Glob Pattern | Workflow Model |\n",
  "| ------ | ------------ | -------------- |\n",
  "| Created | `/content/dam/(wfmin-campaigns|wfmin-events)/.*` | `/var/workflow/models/wfmin-campaigns` |\n",
  "| Created | `/content/dam/wfmin(/.*)` | `/var/workflow/models/dam/update_asset` |\n",
  "| Created | `/content/dam/wfmin/marketing(/.*)` | `/var/workflow/models/wfmin-marketing` |\n",
  "\n",
  "Only one configuration of this service can be active, so we have merged the entries of the following existing configurations into it and removed them:\n",
  "\n",
  "* `ui.apps/src/main/content/jcr_root/apps/wfmin/osgiconfig/config.author/com.adobe.cq.dam.processor.nui.impl.workflow.CustomDamWorkflowRunnerImpl.xml`\n",
  "\n",
  "Note that when using the `postProcWorkflowsByExpression` method of configuring this service, the glob patterns used will differ slightly from the patterns used for workflow launchers.  This is due to the fact that while workflow launchers usually target the original asset binary, the Custom Workflow Runner targets the asset itself.\n",
  "\n",
  "## Workflow Model Updates\n",
  "Many workflow models will combine Adobe-provided asset processing steps with custom customer-defined steps.  In these cases, we have removed most of the Adobe-provided steps from the workflow and configured the workflow to be executed by the Custom Workflow Runner.  When executing workflows via the Custom Workflow Runner service, we require that the workflow end with the DAM Update Asset Completed Process workflow step.  This will mark the asset as _Complete_.  As a result, we have added this step in any workflows where it was missing. \n",
  "\n",
  "We have made changes to the following workflow models:\n",
  "\n",
  "### /conf/global/settings/workflow/models/wfmin-campaigns\n",
  "\n",
  "| Action | Step | Reason |\n",
  "| ------ | ---- | ------ |\n",
  "| Removed | `com.day.cq.dam.core.process.GateKeeperProcess` | This process is not necessary in AEM Assets as a Cloud Service. |\n",
  "| Added | `com.day.cq.dam.core.impl.process.DamUpdateAssetWorkflowCompletedProcess` | Required step added to the workflow. |\n",
  "\n",
  "### /conf/global/settings/workflow/models/wfmin-marketing\n",
  "\n",
  "| Action | Step | Reason |\n",
  "| ------ | ---- | ------ |\n",
  "| Removed | `com.day.cq.dam.scene7.impl.process.Scene7UploadProcess` | This functionality is provided by our OOTB Dynamic Media connectors. |\n",
  "| Added | `com.day.cq.dam.core.impl.process.DamUpdateAssetWorkflowCompletedProcess` | Required step added to the workflow. |\n",
  "\n",
  "### /conf/global/settings/workflow/models/dam/update_asset\n",
  "\n",
  "| Action | Step | Reason |\n",
  "| ------ | ---- | ------ |\n",
  "| Removed | `com.day.cq.dam.core.process.MetadataProcessorProcess` | This functionality is provided by the Asset Compute Service. |\n",
  "| Removed | `com.day.cq.dam.core.process.ThumbnailProcess` | This configuration has been migrated to a processing profile for the Asset Compute Service. |\n",
  "| Removed | `com.day.cq.dam.core.process.CommandLineProcess` | This configuration has been migrated to a processing profile for the Asset Compute Service. |\n",
  "| Added | `com.day.cq.dam.core.impl.process.DamUpdateAssetWorkflowCompletedProcess` | Required step added to the workflow. |\n",
  "\n",
  "\n",
  "## Paths Deleted\n",
  "Workflow nodes under /var paths are no longer required for deployment to AEM as a Cloud Service.  These nodes will automatically be generated at system startup for any workflow models that have previously been synced.  In order to prevent potential deployment issues, the following /var paths have been removed from your Maven projects and filter files:\n",
  "\n",
  "| Action | Path |\n",
  "| ------ | ------- |\n",
  "| Deleted | /var/folders/50/kfpg24ds1vvf9bfvkwffbr580000gq/T/regen-2vH6nw/project/ui.content/src/main/content/jcr_root/var |\n",
  "\n",
  "## Asset Compute Service Processing Profiles\n",
  "By inspecting your workflow step configurations, we were able to automatically generate processing profiles for the Asset Compute Service to encompass configurations that you have customized.  These configurations can be found in the (`aem-cloud-migration.content`) project.\n",
  "\n",
  "| Action | Profile |\n",
  "| ------ | ------- |\n",
  "| Created | Migrated from update_asset |\n",
  "\n",
  "Note that while we have created processing profiles from your workflow model configurations, we are unable to attach these profiles to your existing content structures.  After deploying these profiles to your environment, please visit /mnt/overlay/dam/gui/content/processingprofiles/processingprofiles.html to attach these configurations to one or more folders in your repository.\n",
  "\n",
  "## Migration Issues\n",
  "These issues were encountered while migrating the project by workflow migration tool.\n",
  "\n",
  "| Action | Step | Reason |\n",
  "| ------ | ---- | ------ |\n",
  "| Failed | Command 'convert -resize 25% ${filename} cq5dam.preview-25.png' in update_asset | Not migrated to a processing profile because the geometry 25% is not supported, processing profiles only support WIDTHxHEIGHT. A custom Asset Compute worker is required. |\n",
  "\n",
].join('');

// A read-only copy of the project for tests that only read it; removed when the process exits.
const PROJECT = materializeProject(fs.mkdtempSync(path.join(os.tmpdir(), 'awf-project-')));
process.on('exit', () => fs.rmSync(PROJECT, { recursive: true, force: true }));

module.exports = { PROJECT, TOOL_REPORT, listFiles, copyDir, materializeProject, materializeToolOutput, diffAgainstSnapshot };
