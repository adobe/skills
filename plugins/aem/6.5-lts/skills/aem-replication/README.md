# AEM 6.5 LTS Replication Skills

Comprehensive replication skills for Adobe Experience Manager 6.5 LTS, covering agent configuration, content activation, programmatic API usage, and troubleshooting.

## Skills Included

### 1. Configure Replication Agent
Configure replication agents for content publishing, dispatcher cache flushing, and reverse replication.

**Key capabilities:**
- Default agent setup (Author → Publish)
- Dispatcher Flush agent configuration
- Reverse replication (Publish → Author)
- Multiple publish instance configuration
- Security best practices

**Typical use cases:**
- Initial AEM instance setup
- Adding new publish instances
- Setting up disaster recovery
- Configuring load-balanced environments

### 2. Replicate Content
Activate and deactivate content using various methods from simple Quick Publish to advanced workflows.

**Key capabilities:**
- Quick Publish for simple activation
- Manage Publication for advanced control
- Tree Activation for hierarchical publishing
- Package-based replication
- Workflow-based approval publishing
- Scheduled activation/deactivation
- DAM asset replication

**Typical use cases:**
- Daily content publishing operations
- Marketing campaign launches
- Scheduled content releases
- Bulk content migration

### 3. Replication API
Use the AEM 6.5 LTS Replication API for programmatic content distribution in custom code.

**Key capabilities:**
- Replicator interface methods
- ReplicationOptions configuration
- ReplicationStatus queries
- AgentManager for agent inspection
- ReplicationQueue management
- ReplicationListener for event monitoring
- Complete Java code examples

**Typical use cases:**
- Custom OSGi services
- Workflow process steps
- Servlets with replication logic
- Bulk content operations
- Integration with external systems

### 4. Troubleshoot Replication
Diagnose and fix common replication issues including blocked queues and connectivity failures.

**Key capabilities:**
- Blocked queue diagnosis and resolution
- Connection error troubleshooting
- Authentication and SSL issues
- Dispatcher cache invalidation problems
- Event queue management
- Performance optimization

**Typical use cases:**
- Production incidents
- Content not appearing on Publish
- Slow or stuck replication
- Agent configuration issues
- Queue management

## Documentation Sources

All skills are based on official Adobe AEM 6.5 LTS documentation:

- **Official Replication Guide**: https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/configuring/replication
- **Troubleshooting Guide**: https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/configuring/troubleshoot-rep
- **API Reference**: https://developer.adobe.com/experience-manager/reference-materials/6-5-lts/javadoc/com/day/cq/replication/package-summary.html

## Getting Started

1. **For first-time setup**: Start with [Configure Replication Agent](./configure-replication-agent/SKILL.md)
2. **For daily operations**: Use [Replicate Content](./replicate-content/SKILL.md)
3. **For custom code**: Reference [Replication API](./replication-api/SKILL.md)
4. **For issues**: Consult [Troubleshoot Replication](./troubleshoot-replication/SKILL.md)

## Total Documentation

- **4 comprehensive skills**
- **3,575 lines** of documentation
- **49 Java code examples**
- **12+ common troubleshooting scenarios**
- **100% based on official Adobe documentation**
