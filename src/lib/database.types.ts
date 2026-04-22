export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      action_items: {
        Row: {
          action_category: string | null
          action_type: string
          alert_id: number | null
          assignee_email: string | null
          assignee_name: string | null
          company_id: number | null
          completed_at: string | null
          contact_company: string | null
          contact_id: number | null
          contact_name: string | null
          created_at: string
          description: string
          due_date: string | null
          id: number
          prediction_confidence: number | null
          priority: string
          reason: string | null
          source_id: number | null
          state: string
          thread_id: number | null
          updated_at: string
        }
        Insert: {
          action_category?: string | null
          action_type: string
          alert_id?: number | null
          assignee_email?: string | null
          assignee_name?: string | null
          company_id?: number | null
          completed_at?: string | null
          contact_company?: string | null
          contact_id?: number | null
          contact_name?: string | null
          created_at?: string
          description: string
          due_date?: string | null
          id?: never
          prediction_confidence?: number | null
          priority?: string
          reason?: string | null
          source_id?: number | null
          state?: string
          thread_id?: number | null
          updated_at?: string
        }
        Update: {
          action_category?: string | null
          action_type?: string
          alert_id?: number | null
          assignee_email?: string | null
          assignee_name?: string | null
          company_id?: number | null
          completed_at?: string | null
          contact_company?: string | null
          contact_id?: number | null
          contact_name?: string | null
          created_at?: string
          description?: string
          due_date?: string | null
          id?: never
          prediction_confidence?: number | null
          priority?: string
          reason?: string | null
          source_id?: number | null
          state?: string
          thread_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "action_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "action_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
          {
            foreignKeyName: "action_items_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_insight_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "agent_insights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_insights: {
        Row: {
          agent_id: number
          assignee_department: string | null
          assignee_email: string | null
          assignee_name: string | null
          assignee_user_id: number | null
          business_impact_estimate: number | null
          category: string | null
          company_id: number | null
          confidence: number | null
          contact_id: number | null
          created_at: string | null
          description: string
          evidence: Json | null
          expires_at: string | null
          fiscal_annotation: Json | null
          id: number
          insight_type: string
          recommendation: string | null
          run_id: number | null
          severity: string | null
          source_id: number | null
          state: string | null
          title: string
          updated_at: string | null
          user_feedback: string | null
          was_useful: boolean | null
        }
        Insert: {
          agent_id: number
          assignee_department?: string | null
          assignee_email?: string | null
          assignee_name?: string | null
          assignee_user_id?: number | null
          business_impact_estimate?: number | null
          category?: string | null
          company_id?: number | null
          confidence?: number | null
          contact_id?: number | null
          created_at?: string | null
          description: string
          evidence?: Json | null
          expires_at?: string | null
          fiscal_annotation?: Json | null
          id?: number
          insight_type: string
          recommendation?: string | null
          run_id?: number | null
          severity?: string | null
          source_id?: number | null
          state?: string | null
          title: string
          updated_at?: string | null
          user_feedback?: string | null
          was_useful?: boolean | null
        }
        Update: {
          agent_id?: number
          assignee_department?: string | null
          assignee_email?: string | null
          assignee_name?: string | null
          assignee_user_id?: number | null
          business_impact_estimate?: number | null
          category?: string | null
          company_id?: number | null
          confidence?: number | null
          contact_id?: number | null
          created_at?: string | null
          description?: string
          evidence?: Json | null
          expires_at?: string | null
          fiscal_annotation?: Json | null
          id?: number
          insight_type?: string
          recommendation?: string | null
          run_id?: number | null
          severity?: string | null
          source_id?: number | null
          state?: string | null
          title?: string
          updated_at?: string | null
          user_feedback?: string | null
          was_useful?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_insights_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_effectiveness"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_insights_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_insights_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "director_health_30d"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_insights_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_insights_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "agent_insights_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "agent_insights_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
          {
            foreignKeyName: "agent_insights_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_insights_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_insights_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_memory: {
        Row: {
          agent_id: number
          content: string
          context_id: string | null
          context_type: string | null
          created_at: string | null
          expires_at: string | null
          id: number
          importance: number | null
          last_used_at: string | null
          memory_type: string
          source_id: number | null
          times_used: number | null
          updated_at: string | null
        }
        Insert: {
          agent_id: number
          content: string
          context_id?: string | null
          context_type?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: number
          importance?: number | null
          last_used_at?: string | null
          memory_type: string
          source_id?: number | null
          times_used?: number | null
          updated_at?: string | null
        }
        Update: {
          agent_id?: number
          content?: string
          context_id?: string | null
          context_type?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: number
          importance?: number | null
          last_used_at?: string | null
          memory_type?: string
          source_id?: number | null
          times_used?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_memory_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_effectiveness"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_memory_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_memory_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "director_health_30d"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_memory_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          agent_id: number
          completed_at: string | null
          created_at: string | null
          duration_seconds: number | null
          entities_analyzed: number | null
          error_message: string | null
          id: number
          input_tokens: number | null
          insights_generated: number | null
          metadata: Json | null
          output_tokens: number | null
          started_at: string | null
          status: string
          trigger_type: string
        }
        Insert: {
          agent_id: number
          completed_at?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          entities_analyzed?: number | null
          error_message?: string | null
          id?: number
          input_tokens?: number | null
          insights_generated?: number | null
          metadata?: Json | null
          output_tokens?: number | null
          started_at?: string | null
          status?: string
          trigger_type?: string
        }
        Update: {
          agent_id?: number
          completed_at?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          entities_analyzed?: number | null
          error_message?: string | null
          id?: number
          input_tokens?: number | null
          insights_generated?: number | null
          metadata?: Json | null
          output_tokens?: number | null
          started_at?: string | null
          status?: string
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_effectiveness"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "director_health_30d"
            referencedColumns: ["agent_id"]
          },
        ]
      }
      ai_agents: {
        Row: {
          analysis_schedule: string | null
          archived_at: string | null
          config: Json | null
          created_at: string | null
          description: string | null
          domain: string
          id: number
          is_active: boolean | null
          monthly_budget_tokens: number | null
          name: string
          slug: string
          system_prompt: string
          updated_at: string | null
        }
        Insert: {
          analysis_schedule?: string | null
          archived_at?: string | null
          config?: Json | null
          created_at?: string | null
          description?: string | null
          domain: string
          id?: number
          is_active?: boolean | null
          monthly_budget_tokens?: number | null
          name: string
          slug: string
          system_prompt: string
          updated_at?: string | null
        }
        Update: {
          analysis_schedule?: string | null
          archived_at?: string | null
          config?: Json | null
          created_at?: string | null
          description?: string | null
          domain?: string
          id?: number
          is_active?: boolean | null
          monthly_budget_tokens?: number | null
          name?: string
          slug?: string
          system_prompt?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      ai_extracted_facts: {
        Row: {
          canonical_entity_id: string
          canonical_entity_type: string
          confidence: number
          created_at: string
          expired: boolean
          extracted_at: string
          extraction_run_id: string | null
          fact_date: string | null
          fact_hash: string | null
          fact_text: string
          fact_type: string
          id: number
          is_future: boolean
          legacy_facts_id: number | null
          source_account: string | null
          source_ref: string | null
          source_type: string
          superseded_by: number | null
          verification_source: string | null
          verified: boolean
          verified_at: string | null
        }
        Insert: {
          canonical_entity_id: string
          canonical_entity_type: string
          confidence: number
          created_at?: string
          expired?: boolean
          extracted_at?: string
          extraction_run_id?: string | null
          fact_date?: string | null
          fact_hash?: string | null
          fact_text: string
          fact_type: string
          id?: number
          is_future?: boolean
          legacy_facts_id?: number | null
          source_account?: string | null
          source_ref?: string | null
          source_type: string
          superseded_by?: number | null
          verification_source?: string | null
          verified?: boolean
          verified_at?: string | null
        }
        Update: {
          canonical_entity_id?: string
          canonical_entity_type?: string
          confidence?: number
          created_at?: string
          expired?: boolean
          extracted_at?: string
          extraction_run_id?: string | null
          fact_date?: string | null
          fact_hash?: string | null
          fact_text?: string
          fact_type?: string
          id?: number
          is_future?: boolean
          legacy_facts_id?: number | null
          source_account?: string | null
          source_ref?: string | null
          source_type?: string
          superseded_by?: number | null
          verification_source?: string | null
          verified?: boolean
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_extracted_facts_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "ai_extracted_facts"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          attachment_type: string
          canonical_entity_id: string
          canonical_entity_type: string
          created_at: string
          email_id: number | null
          filename: string | null
          id: number
          metadata: Json | null
          mime_type: string | null
          size_bytes: number | null
          storage_path: string | null
          syntage_file_id: number | null
          uploaded_by: string | null
        }
        Insert: {
          attachment_type: string
          canonical_entity_id: string
          canonical_entity_type: string
          created_at?: string
          email_id?: number | null
          filename?: string | null
          id?: number
          metadata?: Json | null
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          syntage_file_id?: number | null
          uploaded_by?: string | null
        }
        Update: {
          attachment_type?: string
          canonical_entity_id?: string
          canonical_entity_type?: string
          created_at?: string
          email_id?: number | null
          filename?: string | null
          id?: number
          metadata?: Json | null
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          syntage_file_id?: number | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_runs: {
        Row: {
          bucket_key: string
          date_from: string | null
          date_to: string | null
          details: Json | null
          diff: number | null
          id: string
          invariant_key: string
          model: string
          odoo_value: number | null
          run_at: string
          run_id: string
          severity: string
          source: string
          supabase_value: number | null
        }
        Insert: {
          bucket_key?: string
          date_from?: string | null
          date_to?: string | null
          details?: Json | null
          diff?: number | null
          id?: string
          invariant_key: string
          model: string
          odoo_value?: number | null
          run_at?: string
          run_id: string
          severity: string
          source: string
          supabase_value?: number | null
        }
        Update: {
          bucket_key?: string
          date_from?: string | null
          date_to?: string | null
          details?: Json | null
          diff?: number | null
          id?: string
          invariant_key?: string
          model?: string
          odoo_value?: number | null
          run_at?: string
          run_id?: string
          severity?: string
          source?: string
          supabase_value?: number | null
        }
        Relationships: []
      }
      audit_tolerances: {
        Row: {
          abs_tolerance: number
          auto_resolve: boolean | null
          check_cadence: string | null
          enabled: boolean | null
          entity: string | null
          invariant_key: string
          notes: string | null
          pct_tolerance: number
          severity_default: string | null
        }
        Insert: {
          abs_tolerance?: number
          auto_resolve?: boolean | null
          check_cadence?: string | null
          enabled?: boolean | null
          entity?: string | null
          invariant_key: string
          notes?: string | null
          pct_tolerance?: number
          severity_default?: string | null
        }
        Update: {
          abs_tolerance?: number
          auto_resolve?: boolean | null
          check_cadence?: string | null
          enabled?: boolean | null
          entity?: string | null
          invariant_key?: string
          notes?: string | null
          pct_tolerance?: number
          severity_default?: string | null
        }
        Relationships: []
      }
      briefings: {
        Row: {
          account: string
          accounts_failed: number | null
          accounts_processed: number | null
          briefing_date: string
          company_id: number | null
          created_at: string
          department: string | null
          external_contacts: Json | null
          external_emails: number | null
          id: number
          internal_emails: number | null
          key_events: Json | null
          metadata: Json | null
          overall_sentiment: string | null
          risks_detected: Json | null
          scope: string
          sentiment_detail: Json | null
          summary_html: string | null
          summary_text: string | null
          title: string | null
          topics_identified: Json | null
          total_emails: number | null
          urgent_items: Json | null
          waiting_response: Json | null
        }
        Insert: {
          account?: string
          accounts_failed?: number | null
          accounts_processed?: number | null
          briefing_date: string
          company_id?: number | null
          created_at?: string
          department?: string | null
          external_contacts?: Json | null
          external_emails?: number | null
          id?: never
          internal_emails?: number | null
          key_events?: Json | null
          metadata?: Json | null
          overall_sentiment?: string | null
          risks_detected?: Json | null
          scope: string
          sentiment_detail?: Json | null
          summary_html?: string | null
          summary_text?: string | null
          title?: string | null
          topics_identified?: Json | null
          total_emails?: number | null
          urgent_items?: Json | null
          waiting_response?: Json | null
        }
        Update: {
          account?: string
          accounts_failed?: number | null
          accounts_processed?: number | null
          briefing_date?: string
          company_id?: number | null
          created_at?: string
          department?: string | null
          external_contacts?: Json | null
          external_emails?: number | null
          id?: never
          internal_emails?: number | null
          key_events?: Json | null
          metadata?: Json | null
          overall_sentiment?: string | null
          risks_detected?: Json | null
          scope?: string
          sentiment_detail?: Json | null
          summary_html?: string | null
          summary_text?: string | null
          title?: string | null
          topics_identified?: Json | null
          total_emails?: number | null
          urgent_items?: Json | null
          waiting_response?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "briefings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "briefings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "briefings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
        ]
      }
      canonical_companies: {
        Row: {
          ar_aging_buckets: Json | null
          blacklist_action: string | null
          blacklist_cfdis_flagged_count: number | null
          blacklist_first_flagged_at: string | null
          blacklist_last_flagged_at: string | null
          blacklist_level: string
          business_type: string | null
          canonical_name: string
          city: string | null
          completeness_score: number | null
          contact_count: number | null
          country: string | null
          created_at: string
          credit_limit: number | null
          description: string | null
          display_name: string
          domicilio_fiscal: Json | null
          email_count: number | null
          enriched_at: string | null
          enrichment_source: string | null
          has_manual_override: boolean | null
          has_shadow_flag: boolean | null
          id: number
          industry: string | null
          invoices_count: number | null
          invoices_with_cfdi: number | null
          invoices_with_syntage_match: number | null
          is_customer: boolean
          is_internal: boolean
          is_sat_counterparty: boolean | null
          is_supplier: boolean
          key_products: Json | null
          last_email_at: string | null
          last_invoice_date: string | null
          last_matched_at: string | null
          late_deliveries_count: number | null
          lifetime_value_mxn: number | null
          match_confidence: number | null
          match_method: string | null
          max_days_overdue: number | null
          needs_review: boolean | null
          odoo_partner_id: number | null
          opinion_cumplimiento: string | null
          opportunity_signals: Json | null
          otd_rate: number | null
          otd_rate_90d: number | null
          overdue_amount_mxn: number | null
          overdue_count: number | null
          payment_term: string | null
          person_type: string | null
          primary_email_domain: string | null
          primary_entity_kg_id: number | null
          regimen_fiscal: string | null
          relationship_summary: string | null
          relationship_type: string | null
          revenue_90d_mxn: number | null
          revenue_prior_90d_mxn: number | null
          revenue_share_pct: number | null
          revenue_ytd_mxn: number | null
          review_reason: string[] | null
          rfc: string | null
          risk_level: string | null
          risk_signals: Json | null
          sat_compliance_score: number | null
          sat_open_issues_count: number | null
          shadow_reason: string | null
          state: string | null
          strategic_notes: string | null
          street: string | null
          supplier_payment_term: string | null
          tier: string | null
          total_credit_notes_mxn: number | null
          total_deliveries_count: number | null
          total_invoiced_odoo_mxn: number | null
          total_invoiced_sat_mxn: number | null
          total_payable_mxn: number | null
          total_pending_mxn: number | null
          total_receivable_mxn: number | null
          trend_pct: number | null
          updated_at: string
          zip: string | null
        }
        Insert: {
          ar_aging_buckets?: Json | null
          blacklist_action?: string | null
          blacklist_cfdis_flagged_count?: number | null
          blacklist_first_flagged_at?: string | null
          blacklist_last_flagged_at?: string | null
          blacklist_level?: string
          business_type?: string | null
          canonical_name: string
          city?: string | null
          completeness_score?: number | null
          contact_count?: number | null
          country?: string | null
          created_at?: string
          credit_limit?: number | null
          description?: string | null
          display_name: string
          domicilio_fiscal?: Json | null
          email_count?: number | null
          enriched_at?: string | null
          enrichment_source?: string | null
          has_manual_override?: boolean | null
          has_shadow_flag?: boolean | null
          id?: number
          industry?: string | null
          invoices_count?: number | null
          invoices_with_cfdi?: number | null
          invoices_with_syntage_match?: number | null
          is_customer?: boolean
          is_internal?: boolean
          is_sat_counterparty?: boolean | null
          is_supplier?: boolean
          key_products?: Json | null
          last_email_at?: string | null
          last_invoice_date?: string | null
          last_matched_at?: string | null
          late_deliveries_count?: number | null
          lifetime_value_mxn?: number | null
          match_confidence?: number | null
          match_method?: string | null
          max_days_overdue?: number | null
          needs_review?: boolean | null
          odoo_partner_id?: number | null
          opinion_cumplimiento?: string | null
          opportunity_signals?: Json | null
          otd_rate?: number | null
          otd_rate_90d?: number | null
          overdue_amount_mxn?: number | null
          overdue_count?: number | null
          payment_term?: string | null
          person_type?: string | null
          primary_email_domain?: string | null
          primary_entity_kg_id?: number | null
          regimen_fiscal?: string | null
          relationship_summary?: string | null
          relationship_type?: string | null
          revenue_90d_mxn?: number | null
          revenue_prior_90d_mxn?: number | null
          revenue_share_pct?: number | null
          revenue_ytd_mxn?: number | null
          review_reason?: string[] | null
          rfc?: string | null
          risk_level?: string | null
          risk_signals?: Json | null
          sat_compliance_score?: number | null
          sat_open_issues_count?: number | null
          shadow_reason?: string | null
          state?: string | null
          strategic_notes?: string | null
          street?: string | null
          supplier_payment_term?: string | null
          tier?: string | null
          total_credit_notes_mxn?: number | null
          total_deliveries_count?: number | null
          total_invoiced_odoo_mxn?: number | null
          total_invoiced_sat_mxn?: number | null
          total_payable_mxn?: number | null
          total_pending_mxn?: number | null
          total_receivable_mxn?: number | null
          trend_pct?: number | null
          updated_at?: string
          zip?: string | null
        }
        Update: {
          ar_aging_buckets?: Json | null
          blacklist_action?: string | null
          blacklist_cfdis_flagged_count?: number | null
          blacklist_first_flagged_at?: string | null
          blacklist_last_flagged_at?: string | null
          blacklist_level?: string
          business_type?: string | null
          canonical_name?: string
          city?: string | null
          completeness_score?: number | null
          contact_count?: number | null
          country?: string | null
          created_at?: string
          credit_limit?: number | null
          description?: string | null
          display_name?: string
          domicilio_fiscal?: Json | null
          email_count?: number | null
          enriched_at?: string | null
          enrichment_source?: string | null
          has_manual_override?: boolean | null
          has_shadow_flag?: boolean | null
          id?: number
          industry?: string | null
          invoices_count?: number | null
          invoices_with_cfdi?: number | null
          invoices_with_syntage_match?: number | null
          is_customer?: boolean
          is_internal?: boolean
          is_sat_counterparty?: boolean | null
          is_supplier?: boolean
          key_products?: Json | null
          last_email_at?: string | null
          last_invoice_date?: string | null
          last_matched_at?: string | null
          late_deliveries_count?: number | null
          lifetime_value_mxn?: number | null
          match_confidence?: number | null
          match_method?: string | null
          max_days_overdue?: number | null
          needs_review?: boolean | null
          odoo_partner_id?: number | null
          opinion_cumplimiento?: string | null
          opportunity_signals?: Json | null
          otd_rate?: number | null
          otd_rate_90d?: number | null
          overdue_amount_mxn?: number | null
          overdue_count?: number | null
          payment_term?: string | null
          person_type?: string | null
          primary_email_domain?: string | null
          primary_entity_kg_id?: number | null
          regimen_fiscal?: string | null
          relationship_summary?: string | null
          relationship_type?: string | null
          revenue_90d_mxn?: number | null
          revenue_prior_90d_mxn?: number | null
          revenue_share_pct?: number | null
          revenue_ytd_mxn?: number | null
          review_reason?: string[] | null
          rfc?: string | null
          risk_level?: string | null
          risk_signals?: Json | null
          sat_compliance_score?: number | null
          sat_open_issues_count?: number | null
          shadow_reason?: string | null
          state?: string | null
          strategic_notes?: string | null
          street?: string | null
          supplier_payment_term?: string | null
          tier?: string | null
          total_credit_notes_mxn?: number | null
          total_deliveries_count?: number | null
          total_invoiced_odoo_mxn?: number | null
          total_invoiced_sat_mxn?: number | null
          total_payable_mxn?: number | null
          total_pending_mxn?: number | null
          total_receivable_mxn?: number | null
          trend_pct?: number | null
          updated_at?: string
          zip?: string | null
        }
        Relationships: []
      }
      canonical_contacts: {
        Row: {
          avg_response_time_hours: number | null
          canonical_company_id: number | null
          canonical_name: string
          communication_style: string | null
          completeness_score: number | null
          contact_type: string
          created_at: string
          current_health_score: number | null
          decision_power: string | null
          delivery_otd_rate: number | null
          department: string | null
          display_name: string
          first_seen_at: string | null
          has_manual_override: boolean | null
          has_shadow_flag: boolean | null
          health_trend: string | null
          id: number
          influence_on_deals: string | null
          is_customer: boolean
          is_supplier: boolean
          language_preference: string | null
          last_activity_at: string | null
          last_matched_at: string | null
          lifetime_value_mxn: number | null
          manager_canonical_contact_id: number | null
          match_confidence: number | null
          match_method: string | null
          needs_review: boolean | null
          negotiation_style: string | null
          odoo_employee_id: number | null
          odoo_partner_id: number | null
          odoo_user_id: number | null
          open_alerts_count: number | null
          payment_compliance_score: number | null
          pending_actions_count: number | null
          personality_notes: string | null
          primary_email: string
          primary_entity_kg_id: number | null
          relationship_score: number | null
          response_pattern: string | null
          review_reason: string[] | null
          risk_level: string | null
          role: string | null
          sentiment_score: number | null
          total_received: number | null
          total_sent: number | null
          updated_at: string
        }
        Insert: {
          avg_response_time_hours?: number | null
          canonical_company_id?: number | null
          canonical_name: string
          communication_style?: string | null
          completeness_score?: number | null
          contact_type: string
          created_at?: string
          current_health_score?: number | null
          decision_power?: string | null
          delivery_otd_rate?: number | null
          department?: string | null
          display_name: string
          first_seen_at?: string | null
          has_manual_override?: boolean | null
          has_shadow_flag?: boolean | null
          health_trend?: string | null
          id?: number
          influence_on_deals?: string | null
          is_customer?: boolean
          is_supplier?: boolean
          language_preference?: string | null
          last_activity_at?: string | null
          last_matched_at?: string | null
          lifetime_value_mxn?: number | null
          manager_canonical_contact_id?: number | null
          match_confidence?: number | null
          match_method?: string | null
          needs_review?: boolean | null
          negotiation_style?: string | null
          odoo_employee_id?: number | null
          odoo_partner_id?: number | null
          odoo_user_id?: number | null
          open_alerts_count?: number | null
          payment_compliance_score?: number | null
          pending_actions_count?: number | null
          personality_notes?: string | null
          primary_email: string
          primary_entity_kg_id?: number | null
          relationship_score?: number | null
          response_pattern?: string | null
          review_reason?: string[] | null
          risk_level?: string | null
          role?: string | null
          sentiment_score?: number | null
          total_received?: number | null
          total_sent?: number | null
          updated_at?: string
        }
        Update: {
          avg_response_time_hours?: number | null
          canonical_company_id?: number | null
          canonical_name?: string
          communication_style?: string | null
          completeness_score?: number | null
          contact_type?: string
          created_at?: string
          current_health_score?: number | null
          decision_power?: string | null
          delivery_otd_rate?: number | null
          department?: string | null
          display_name?: string
          first_seen_at?: string | null
          has_manual_override?: boolean | null
          has_shadow_flag?: boolean | null
          health_trend?: string | null
          id?: number
          influence_on_deals?: string | null
          is_customer?: boolean
          is_supplier?: boolean
          language_preference?: string | null
          last_activity_at?: string | null
          last_matched_at?: string | null
          lifetime_value_mxn?: number | null
          manager_canonical_contact_id?: number | null
          match_confidence?: number | null
          match_method?: string | null
          needs_review?: boolean | null
          negotiation_style?: string | null
          odoo_employee_id?: number | null
          odoo_partner_id?: number | null
          odoo_user_id?: number | null
          open_alerts_count?: number | null
          payment_compliance_score?: number | null
          pending_actions_count?: number | null
          personality_notes?: string | null
          primary_email?: string
          primary_entity_kg_id?: number | null
          relationship_score?: number | null
          response_pattern?: string | null
          review_reason?: string[] | null
          risk_level?: string | null
          role?: string | null
          sentiment_score?: number | null
          total_received?: number | null
          total_sent?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "canonical_contacts_canonical_company_id_fkey"
            columns: ["canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canonical_contacts_canonical_company_id_fkey"
            columns: ["canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_crm_leads"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "canonical_contacts_canonical_company_id_fkey"
            columns: ["canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_deliveries"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "canonical_contacts_canonical_company_id_fkey"
            columns: ["canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_order_lines"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "canonical_contacts_canonical_company_id_fkey"
            columns: ["canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_purchase_orders"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "canonical_contacts_canonical_company_id_fkey"
            columns: ["canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_sale_orders"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "canonical_contacts_canonical_company_id_fkey"
            columns: ["canonical_company_id"]
            isOneToOne: false
            referencedRelation: "gold_company_360"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "canonical_contacts_manager_canonical_contact_id_fkey"
            columns: ["manager_canonical_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canonical_contacts_manager_canonical_contact_id_fkey"
            columns: ["manager_canonical_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_crm_leads"
            referencedColumns: ["assignee_canonical_contact_id"]
          },
          {
            foreignKeyName: "canonical_contacts_manager_canonical_contact_id_fkey"
            columns: ["manager_canonical_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_employees"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "canonical_contacts_manager_canonical_contact_id_fkey"
            columns: ["manager_canonical_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_purchase_orders"
            referencedColumns: ["buyer_canonical_contact_id"]
          },
          {
            foreignKeyName: "canonical_contacts_manager_canonical_contact_id_fkey"
            columns: ["manager_canonical_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_sale_orders"
            referencedColumns: ["salesperson_canonical_contact_id"]
          },
        ]
      }
      canonical_credit_notes: {
        Row: {
          amount_total_diff_abs: number | null
          amount_total_mxn_odoo: number | null
          amount_total_mxn_resolved: number | null
          amount_total_mxn_sat: number | null
          amount_total_odoo: number | null
          amount_total_resolved: number | null
          amount_total_sat: number | null
          canonical_id: string
          completeness_score: number | null
          created_at: string
          currency_odoo: string | null
          currency_sat: string | null
          direction: string
          emisor_canonical_company_id: number | null
          emisor_nombre: string | null
          emisor_rfc: string | null
          estado_sat: string | null
          fecha_cancelacion: string | null
          fecha_emision: string | null
          fecha_timbrado: string | null
          has_manual_link: boolean
          has_odoo_record: boolean
          has_sat_record: boolean
          historical_pre_odoo: boolean | null
          invoice_date: string | null
          last_reconciled_at: string | null
          move_type_odoo: string | null
          needs_review: boolean | null
          odoo_invoice_id: number | null
          odoo_partner_id: number | null
          pending_operationalization: boolean | null
          receptor_canonical_company_id: number | null
          receptor_nombre: string | null
          receptor_rfc: string | null
          related_invoice_canonical_id: string | null
          related_invoice_uuid: string | null
          reversed_entry_id_odoo: number | null
          review_reason: string[] | null
          sat_uuid: string | null
          source_hashes: Json | null
          sources_missing: string[]
          sources_present: string[]
          state_mismatch: boolean | null
          state_odoo: string | null
          tipo_cambio_sat: number | null
          tipo_comprobante_sat: string
          tipo_relacion: string | null
          updated_at: string
        }
        Insert: {
          amount_total_diff_abs?: number | null
          amount_total_mxn_odoo?: number | null
          amount_total_mxn_resolved?: number | null
          amount_total_mxn_sat?: number | null
          amount_total_odoo?: number | null
          amount_total_resolved?: number | null
          amount_total_sat?: number | null
          canonical_id: string
          completeness_score?: number | null
          created_at?: string
          currency_odoo?: string | null
          currency_sat?: string | null
          direction: string
          emisor_canonical_company_id?: number | null
          emisor_nombre?: string | null
          emisor_rfc?: string | null
          estado_sat?: string | null
          fecha_cancelacion?: string | null
          fecha_emision?: string | null
          fecha_timbrado?: string | null
          has_manual_link?: boolean
          has_odoo_record?: boolean
          has_sat_record?: boolean
          historical_pre_odoo?: boolean | null
          invoice_date?: string | null
          last_reconciled_at?: string | null
          move_type_odoo?: string | null
          needs_review?: boolean | null
          odoo_invoice_id?: number | null
          odoo_partner_id?: number | null
          pending_operationalization?: boolean | null
          receptor_canonical_company_id?: number | null
          receptor_nombre?: string | null
          receptor_rfc?: string | null
          related_invoice_canonical_id?: string | null
          related_invoice_uuid?: string | null
          reversed_entry_id_odoo?: number | null
          review_reason?: string[] | null
          sat_uuid?: string | null
          source_hashes?: Json | null
          sources_missing?: string[]
          sources_present?: string[]
          state_mismatch?: boolean | null
          state_odoo?: string | null
          tipo_cambio_sat?: number | null
          tipo_comprobante_sat?: string
          tipo_relacion?: string | null
          updated_at?: string
        }
        Update: {
          amount_total_diff_abs?: number | null
          amount_total_mxn_odoo?: number | null
          amount_total_mxn_resolved?: number | null
          amount_total_mxn_sat?: number | null
          amount_total_odoo?: number | null
          amount_total_resolved?: number | null
          amount_total_sat?: number | null
          canonical_id?: string
          completeness_score?: number | null
          created_at?: string
          currency_odoo?: string | null
          currency_sat?: string | null
          direction?: string
          emisor_canonical_company_id?: number | null
          emisor_nombre?: string | null
          emisor_rfc?: string | null
          estado_sat?: string | null
          fecha_cancelacion?: string | null
          fecha_emision?: string | null
          fecha_timbrado?: string | null
          has_manual_link?: boolean
          has_odoo_record?: boolean
          has_sat_record?: boolean
          historical_pre_odoo?: boolean | null
          invoice_date?: string | null
          last_reconciled_at?: string | null
          move_type_odoo?: string | null
          needs_review?: boolean | null
          odoo_invoice_id?: number | null
          odoo_partner_id?: number | null
          pending_operationalization?: boolean | null
          receptor_canonical_company_id?: number | null
          receptor_nombre?: string | null
          receptor_rfc?: string | null
          related_invoice_canonical_id?: string | null
          related_invoice_uuid?: string | null
          reversed_entry_id_odoo?: number | null
          review_reason?: string[] | null
          sat_uuid?: string | null
          source_hashes?: Json | null
          sources_missing?: string[]
          sources_present?: string[]
          state_mismatch?: boolean | null
          state_odoo?: string | null
          tipo_cambio_sat?: number | null
          tipo_comprobante_sat?: string
          tipo_relacion?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_ccn_emisor"
            columns: ["emisor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ccn_emisor"
            columns: ["emisor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_crm_leads"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ccn_emisor"
            columns: ["emisor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_deliveries"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ccn_emisor"
            columns: ["emisor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_order_lines"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ccn_emisor"
            columns: ["emisor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_purchase_orders"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ccn_emisor"
            columns: ["emisor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_sale_orders"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ccn_emisor"
            columns: ["emisor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "gold_company_360"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ccn_receptor"
            columns: ["receptor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ccn_receptor"
            columns: ["receptor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_crm_leads"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ccn_receptor"
            columns: ["receptor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_deliveries"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ccn_receptor"
            columns: ["receptor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_order_lines"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ccn_receptor"
            columns: ["receptor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_purchase_orders"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ccn_receptor"
            columns: ["receptor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_sale_orders"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ccn_receptor"
            columns: ["receptor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "gold_company_360"
            referencedColumns: ["canonical_company_id"]
          },
        ]
      }
      canonical_invoices: {
        Row: {
          amount_credited_sat: number | null
          amount_paid_odoo: number | null
          amount_paid_sat: number | null
          amount_residual_mxn_odoo: number | null
          amount_residual_mxn_resolved: number | null
          amount_residual_odoo: number | null
          amount_residual_resolved: number | null
          amount_residual_sat: number | null
          amount_retenciones_sat: number | null
          amount_tax_odoo: number | null
          amount_tax_sat: number | null
          amount_total_diff_abs: number | null
          amount_total_has_discrepancy: boolean | null
          amount_total_mxn_diff_abs: number | null
          amount_total_mxn_diff_pct: number | null
          amount_total_mxn_fiscal: number | null
          amount_total_mxn_odoo: number | null
          amount_total_mxn_ops: number | null
          amount_total_mxn_resolved: number | null
          amount_total_mxn_sat: number | null
          amount_total_odoo: number | null
          amount_total_resolved: number | null
          amount_total_sat: number | null
          amount_untaxed_odoo: number | null
          amount_untaxed_sat: number | null
          blacklist_action: string | null
          canonical_id: string
          cfdi_sat_state_odoo: string | null
          cfdi_uuid_odoo: string | null
          completeness_score: number | null
          created_at: string
          currency_odoo: string | null
          currency_sat: string | null
          date_has_discrepancy: boolean | null
          direction: string
          due_date_odoo: string | null
          due_date_resolved: string | null
          edi_state_odoo: string | null
          emisor_blacklist_status: string | null
          emisor_canonical_company_id: number | null
          emisor_nombre: string | null
          emisor_rfc: string | null
          estado_sat: string | null
          fecha_cancelacion: string | null
          fecha_emision: string | null
          fecha_timbrado: string | null
          fiscal_cancellation_process_status: string | null
          fiscal_days_to_due_date: number | null
          fiscal_days_to_full_payment: number | null
          fiscal_due_date: string | null
          fiscal_fully_paid_at: string | null
          fiscal_last_payment_date: string | null
          fiscal_payment_terms: Json | null
          fiscal_payment_terms_raw: string | null
          folio: string | null
          forma_pago: string | null
          has_email_thread: boolean
          has_manual_link: boolean
          has_odoo_record: boolean
          has_sat_record: boolean
          historical_pre_odoo: boolean | null
          invoice_date: string | null
          last_reconciled_at: string | null
          match_confidence: string | null
          match_evidence: Json | null
          metodo_pago: string | null
          move_type_odoo: string | null
          needs_review: boolean | null
          odoo_invoice_id: number | null
          odoo_name: string | null
          odoo_partner_id: number | null
          odoo_ref: string | null
          payment_date_odoo: string | null
          payment_state_odoo: string | null
          payment_term_odoo: string | null
          pending_operationalization: boolean | null
          receptor_blacklist_status: string | null
          receptor_canonical_company_id: number | null
          receptor_nombre: string | null
          receptor_rfc: string | null
          resolved_from: string | null
          review_reason: string[] | null
          salesperson_contact_id: number | null
          salesperson_user_id: number | null
          sat_uuid: string | null
          serie: string | null
          source_hashes: Json | null
          sources_missing: string[]
          sources_present: string[]
          state_mismatch: boolean | null
          state_odoo: string | null
          tipo_cambio_odoo: number | null
          tipo_cambio_sat: number | null
          tipo_comprobante_sat: string | null
          updated_at: string
          uso_cfdi: string | null
        }
        Insert: {
          amount_credited_sat?: number | null
          amount_paid_odoo?: number | null
          amount_paid_sat?: number | null
          amount_residual_mxn_odoo?: number | null
          amount_residual_mxn_resolved?: number | null
          amount_residual_odoo?: number | null
          amount_residual_resolved?: number | null
          amount_residual_sat?: number | null
          amount_retenciones_sat?: number | null
          amount_tax_odoo?: number | null
          amount_tax_sat?: number | null
          amount_total_diff_abs?: number | null
          amount_total_has_discrepancy?: boolean | null
          amount_total_mxn_diff_abs?: number | null
          amount_total_mxn_diff_pct?: number | null
          amount_total_mxn_fiscal?: number | null
          amount_total_mxn_odoo?: number | null
          amount_total_mxn_ops?: number | null
          amount_total_mxn_resolved?: number | null
          amount_total_mxn_sat?: number | null
          amount_total_odoo?: number | null
          amount_total_resolved?: number | null
          amount_total_sat?: number | null
          amount_untaxed_odoo?: number | null
          amount_untaxed_sat?: number | null
          blacklist_action?: string | null
          canonical_id: string
          cfdi_sat_state_odoo?: string | null
          cfdi_uuid_odoo?: string | null
          completeness_score?: number | null
          created_at?: string
          currency_odoo?: string | null
          currency_sat?: string | null
          date_has_discrepancy?: boolean | null
          direction: string
          due_date_odoo?: string | null
          due_date_resolved?: string | null
          edi_state_odoo?: string | null
          emisor_blacklist_status?: string | null
          emisor_canonical_company_id?: number | null
          emisor_nombre?: string | null
          emisor_rfc?: string | null
          estado_sat?: string | null
          fecha_cancelacion?: string | null
          fecha_emision?: string | null
          fecha_timbrado?: string | null
          fiscal_cancellation_process_status?: string | null
          fiscal_days_to_due_date?: number | null
          fiscal_days_to_full_payment?: number | null
          fiscal_due_date?: string | null
          fiscal_fully_paid_at?: string | null
          fiscal_last_payment_date?: string | null
          fiscal_payment_terms?: Json | null
          fiscal_payment_terms_raw?: string | null
          folio?: string | null
          forma_pago?: string | null
          has_email_thread?: boolean
          has_manual_link?: boolean
          has_odoo_record?: boolean
          has_sat_record?: boolean
          historical_pre_odoo?: boolean | null
          invoice_date?: string | null
          last_reconciled_at?: string | null
          match_confidence?: string | null
          match_evidence?: Json | null
          metodo_pago?: string | null
          move_type_odoo?: string | null
          needs_review?: boolean | null
          odoo_invoice_id?: number | null
          odoo_name?: string | null
          odoo_partner_id?: number | null
          odoo_ref?: string | null
          payment_date_odoo?: string | null
          payment_state_odoo?: string | null
          payment_term_odoo?: string | null
          pending_operationalization?: boolean | null
          receptor_blacklist_status?: string | null
          receptor_canonical_company_id?: number | null
          receptor_nombre?: string | null
          receptor_rfc?: string | null
          resolved_from?: string | null
          review_reason?: string[] | null
          salesperson_contact_id?: number | null
          salesperson_user_id?: number | null
          sat_uuid?: string | null
          serie?: string | null
          source_hashes?: Json | null
          sources_missing?: string[]
          sources_present?: string[]
          state_mismatch?: boolean | null
          state_odoo?: string | null
          tipo_cambio_odoo?: number | null
          tipo_cambio_sat?: number | null
          tipo_comprobante_sat?: string | null
          updated_at?: string
          uso_cfdi?: string | null
        }
        Update: {
          amount_credited_sat?: number | null
          amount_paid_odoo?: number | null
          amount_paid_sat?: number | null
          amount_residual_mxn_odoo?: number | null
          amount_residual_mxn_resolved?: number | null
          amount_residual_odoo?: number | null
          amount_residual_resolved?: number | null
          amount_residual_sat?: number | null
          amount_retenciones_sat?: number | null
          amount_tax_odoo?: number | null
          amount_tax_sat?: number | null
          amount_total_diff_abs?: number | null
          amount_total_has_discrepancy?: boolean | null
          amount_total_mxn_diff_abs?: number | null
          amount_total_mxn_diff_pct?: number | null
          amount_total_mxn_fiscal?: number | null
          amount_total_mxn_odoo?: number | null
          amount_total_mxn_ops?: number | null
          amount_total_mxn_resolved?: number | null
          amount_total_mxn_sat?: number | null
          amount_total_odoo?: number | null
          amount_total_resolved?: number | null
          amount_total_sat?: number | null
          amount_untaxed_odoo?: number | null
          amount_untaxed_sat?: number | null
          blacklist_action?: string | null
          canonical_id?: string
          cfdi_sat_state_odoo?: string | null
          cfdi_uuid_odoo?: string | null
          completeness_score?: number | null
          created_at?: string
          currency_odoo?: string | null
          currency_sat?: string | null
          date_has_discrepancy?: boolean | null
          direction?: string
          due_date_odoo?: string | null
          due_date_resolved?: string | null
          edi_state_odoo?: string | null
          emisor_blacklist_status?: string | null
          emisor_canonical_company_id?: number | null
          emisor_nombre?: string | null
          emisor_rfc?: string | null
          estado_sat?: string | null
          fecha_cancelacion?: string | null
          fecha_emision?: string | null
          fecha_timbrado?: string | null
          fiscal_cancellation_process_status?: string | null
          fiscal_days_to_due_date?: number | null
          fiscal_days_to_full_payment?: number | null
          fiscal_due_date?: string | null
          fiscal_fully_paid_at?: string | null
          fiscal_last_payment_date?: string | null
          fiscal_payment_terms?: Json | null
          fiscal_payment_terms_raw?: string | null
          folio?: string | null
          forma_pago?: string | null
          has_email_thread?: boolean
          has_manual_link?: boolean
          has_odoo_record?: boolean
          has_sat_record?: boolean
          historical_pre_odoo?: boolean | null
          invoice_date?: string | null
          last_reconciled_at?: string | null
          match_confidence?: string | null
          match_evidence?: Json | null
          metodo_pago?: string | null
          move_type_odoo?: string | null
          needs_review?: boolean | null
          odoo_invoice_id?: number | null
          odoo_name?: string | null
          odoo_partner_id?: number | null
          odoo_ref?: string | null
          payment_date_odoo?: string | null
          payment_state_odoo?: string | null
          payment_term_odoo?: string | null
          pending_operationalization?: boolean | null
          receptor_blacklist_status?: string | null
          receptor_canonical_company_id?: number | null
          receptor_nombre?: string | null
          receptor_rfc?: string | null
          resolved_from?: string | null
          review_reason?: string[] | null
          salesperson_contact_id?: number | null
          salesperson_user_id?: number | null
          sat_uuid?: string | null
          serie?: string | null
          source_hashes?: Json | null
          sources_missing?: string[]
          sources_present?: string[]
          state_mismatch?: boolean | null
          state_odoo?: string | null
          tipo_cambio_odoo?: number | null
          tipo_cambio_sat?: number | null
          tipo_comprobante_sat?: string | null
          updated_at?: string
          uso_cfdi?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_ci_emisor"
            columns: ["emisor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ci_emisor"
            columns: ["emisor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_crm_leads"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ci_emisor"
            columns: ["emisor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_deliveries"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ci_emisor"
            columns: ["emisor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_order_lines"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ci_emisor"
            columns: ["emisor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_purchase_orders"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ci_emisor"
            columns: ["emisor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_sale_orders"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ci_emisor"
            columns: ["emisor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "gold_company_360"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ci_receptor"
            columns: ["receptor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ci_receptor"
            columns: ["receptor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_crm_leads"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ci_receptor"
            columns: ["receptor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_deliveries"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ci_receptor"
            columns: ["receptor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_order_lines"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ci_receptor"
            columns: ["receptor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_purchase_orders"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ci_receptor"
            columns: ["receptor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_sale_orders"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ci_receptor"
            columns: ["receptor_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "gold_company_360"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ci_sp"
            columns: ["salesperson_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ci_sp"
            columns: ["salesperson_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_crm_leads"
            referencedColumns: ["assignee_canonical_contact_id"]
          },
          {
            foreignKeyName: "fk_ci_sp"
            columns: ["salesperson_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_employees"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "fk_ci_sp"
            columns: ["salesperson_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_purchase_orders"
            referencedColumns: ["buyer_canonical_contact_id"]
          },
          {
            foreignKeyName: "fk_ci_sp"
            columns: ["salesperson_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_sale_orders"
            referencedColumns: ["salesperson_canonical_contact_id"]
          },
        ]
      }
      canonical_payment_allocations: {
        Row: {
          allocated_amount: number
          created_at: string
          currency: string | null
          id: number
          invoice_canonical_id: string
          payment_canonical_id: string
          sat_num_parcialidad: number | null
          sat_saldo_anterior: number | null
          sat_saldo_insoluto: number | null
          source: string
        }
        Insert: {
          allocated_amount: number
          created_at?: string
          currency?: string | null
          id?: number
          invoice_canonical_id: string
          payment_canonical_id: string
          sat_num_parcialidad?: number | null
          sat_saldo_anterior?: number | null
          sat_saldo_insoluto?: number | null
          source: string
        }
        Update: {
          allocated_amount?: number
          created_at?: string
          currency?: string | null
          id?: number
          invoice_canonical_id?: string
          payment_canonical_id?: string
          sat_num_parcialidad?: number | null
          sat_saldo_anterior?: number | null
          sat_saldo_insoluto?: number | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "canonical_payment_allocations_payment_canonical_id_fkey"
            columns: ["payment_canonical_id"]
            isOneToOne: false
            referencedRelation: "canonical_payments"
            referencedColumns: ["canonical_id"]
          },
        ]
      }
      canonical_payments: {
        Row: {
          allocated_invoices_uuid: string[] | null
          allocation_count: number | null
          amount_allocated: number | null
          amount_diff_abs: number | null
          amount_has_discrepancy: boolean | null
          amount_mxn_odoo: number | null
          amount_mxn_resolved: number | null
          amount_mxn_sat: number | null
          amount_odoo: number | null
          amount_resolved: number | null
          amount_sat: number | null
          amount_unallocated: number | null
          canonical_id: string
          complement_without_payment: boolean | null
          completeness_score: number | null
          counterparty_canonical_company_id: number | null
          created_at: string
          currency_odoo: string | null
          currency_sat: string | null
          date_has_discrepancy: boolean | null
          direction: string
          estado_sat: string | null
          fecha_pago_sat: string | null
          forma_pago_sat: string | null
          has_manual_link: boolean
          has_odoo_record: boolean
          has_sat_record: boolean
          is_reconciled: boolean | null
          journal_name: string | null
          journal_type: string | null
          last_reconciled_at: string | null
          needs_review: boolean | null
          num_operacion: string | null
          odoo_partner_id: number | null
          odoo_payment_id: number | null
          odoo_ref: string | null
          partner_name: string | null
          payment_date_odoo: string | null
          payment_date_resolved: string | null
          payment_method_odoo: string | null
          reconciled_invoices_count: number | null
          registered_but_not_fiscally_confirmed: boolean | null
          review_reason: string[] | null
          rfc_emisor_cta_ben: string | null
          rfc_emisor_cta_ord: string | null
          sat_uuid_complemento: string | null
          source_hashes: Json | null
          sources_missing: string[]
          sources_present: string[]
          tipo_cambio_sat: number | null
          updated_at: string
        }
        Insert: {
          allocated_invoices_uuid?: string[] | null
          allocation_count?: number | null
          amount_allocated?: number | null
          amount_diff_abs?: number | null
          amount_has_discrepancy?: boolean | null
          amount_mxn_odoo?: number | null
          amount_mxn_resolved?: number | null
          amount_mxn_sat?: number | null
          amount_odoo?: number | null
          amount_resolved?: number | null
          amount_sat?: number | null
          amount_unallocated?: number | null
          canonical_id: string
          complement_without_payment?: boolean | null
          completeness_score?: number | null
          counterparty_canonical_company_id?: number | null
          created_at?: string
          currency_odoo?: string | null
          currency_sat?: string | null
          date_has_discrepancy?: boolean | null
          direction: string
          estado_sat?: string | null
          fecha_pago_sat?: string | null
          forma_pago_sat?: string | null
          has_manual_link?: boolean
          has_odoo_record?: boolean
          has_sat_record?: boolean
          is_reconciled?: boolean | null
          journal_name?: string | null
          journal_type?: string | null
          last_reconciled_at?: string | null
          needs_review?: boolean | null
          num_operacion?: string | null
          odoo_partner_id?: number | null
          odoo_payment_id?: number | null
          odoo_ref?: string | null
          partner_name?: string | null
          payment_date_odoo?: string | null
          payment_date_resolved?: string | null
          payment_method_odoo?: string | null
          reconciled_invoices_count?: number | null
          registered_but_not_fiscally_confirmed?: boolean | null
          review_reason?: string[] | null
          rfc_emisor_cta_ben?: string | null
          rfc_emisor_cta_ord?: string | null
          sat_uuid_complemento?: string | null
          source_hashes?: Json | null
          sources_missing?: string[]
          sources_present?: string[]
          tipo_cambio_sat?: number | null
          updated_at?: string
        }
        Update: {
          allocated_invoices_uuid?: string[] | null
          allocation_count?: number | null
          amount_allocated?: number | null
          amount_diff_abs?: number | null
          amount_has_discrepancy?: boolean | null
          amount_mxn_odoo?: number | null
          amount_mxn_resolved?: number | null
          amount_mxn_sat?: number | null
          amount_odoo?: number | null
          amount_resolved?: number | null
          amount_sat?: number | null
          amount_unallocated?: number | null
          canonical_id?: string
          complement_without_payment?: boolean | null
          completeness_score?: number | null
          counterparty_canonical_company_id?: number | null
          created_at?: string
          currency_odoo?: string | null
          currency_sat?: string | null
          date_has_discrepancy?: boolean | null
          direction?: string
          estado_sat?: string | null
          fecha_pago_sat?: string | null
          forma_pago_sat?: string | null
          has_manual_link?: boolean
          has_odoo_record?: boolean
          has_sat_record?: boolean
          is_reconciled?: boolean | null
          journal_name?: string | null
          journal_type?: string | null
          last_reconciled_at?: string | null
          needs_review?: boolean | null
          num_operacion?: string | null
          odoo_partner_id?: number | null
          odoo_payment_id?: number | null
          odoo_ref?: string | null
          partner_name?: string | null
          payment_date_odoo?: string | null
          payment_date_resolved?: string | null
          payment_method_odoo?: string | null
          reconciled_invoices_count?: number | null
          registered_but_not_fiscally_confirmed?: boolean | null
          review_reason?: string[] | null
          rfc_emisor_cta_ben?: string | null
          rfc_emisor_cta_ord?: string | null
          sat_uuid_complemento?: string | null
          source_hashes?: Json | null
          sources_missing?: string[]
          sources_present?: string[]
          tipo_cambio_sat?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_cp_counterparty"
            columns: ["counterparty_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cp_counterparty"
            columns: ["counterparty_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_crm_leads"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_cp_counterparty"
            columns: ["counterparty_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_deliveries"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_cp_counterparty"
            columns: ["counterparty_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_order_lines"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_cp_counterparty"
            columns: ["counterparty_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_purchase_orders"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_cp_counterparty"
            columns: ["counterparty_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_sale_orders"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_cp_counterparty"
            columns: ["counterparty_canonical_company_id"]
            isOneToOne: false
            referencedRelation: "gold_company_360"
            referencedColumns: ["canonical_company_id"]
          },
        ]
      }
      canonical_products: {
        Row: {
          available_qty: number | null
          avg_cost_mxn: number | null
          barcode: string | null
          canonical_name: string
          category: string | null
          completeness_score: number | null
          created_at: string
          display_name: string
          fiscal_map_confidence: string | null
          fiscal_map_updated_at: string | null
          has_manual_override: boolean | null
          id: number
          internal_ref: string
          is_active: boolean | null
          last_list_price_change_at: string | null
          last_matched_at: string | null
          last_sat_invoice_date: string | null
          list_price_mxn: number | null
          margin_pct_12m: number | null
          needs_review: boolean | null
          odoo_product_id: number
          odoo_revenue_mxn_12m: number | null
          primary_entity_kg_id: number | null
          product_type: string | null
          reorder_max: number | null
          reorder_min: number | null
          reserved_qty: number | null
          sat_clave_prod_serv: string | null
          sat_clave_unidad: string | null
          sat_line_count_12m: number | null
          sat_revenue_mxn_12m: number | null
          standard_price_mxn: number | null
          stock_qty: number | null
          top_customers_canonical_ids: number[] | null
          top_suppliers_canonical_ids: number[] | null
          uom: string | null
          updated_at: string
          weight: number | null
        }
        Insert: {
          available_qty?: number | null
          avg_cost_mxn?: number | null
          barcode?: string | null
          canonical_name: string
          category?: string | null
          completeness_score?: number | null
          created_at?: string
          display_name: string
          fiscal_map_confidence?: string | null
          fiscal_map_updated_at?: string | null
          has_manual_override?: boolean | null
          id?: number
          internal_ref: string
          is_active?: boolean | null
          last_list_price_change_at?: string | null
          last_matched_at?: string | null
          last_sat_invoice_date?: string | null
          list_price_mxn?: number | null
          margin_pct_12m?: number | null
          needs_review?: boolean | null
          odoo_product_id: number
          odoo_revenue_mxn_12m?: number | null
          primary_entity_kg_id?: number | null
          product_type?: string | null
          reorder_max?: number | null
          reorder_min?: number | null
          reserved_qty?: number | null
          sat_clave_prod_serv?: string | null
          sat_clave_unidad?: string | null
          sat_line_count_12m?: number | null
          sat_revenue_mxn_12m?: number | null
          standard_price_mxn?: number | null
          stock_qty?: number | null
          top_customers_canonical_ids?: number[] | null
          top_suppliers_canonical_ids?: number[] | null
          uom?: string | null
          updated_at?: string
          weight?: number | null
        }
        Update: {
          available_qty?: number | null
          avg_cost_mxn?: number | null
          barcode?: string | null
          canonical_name?: string
          category?: string | null
          completeness_score?: number | null
          created_at?: string
          display_name?: string
          fiscal_map_confidence?: string | null
          fiscal_map_updated_at?: string | null
          has_manual_override?: boolean | null
          id?: number
          internal_ref?: string
          is_active?: boolean | null
          last_list_price_change_at?: string | null
          last_matched_at?: string | null
          last_sat_invoice_date?: string | null
          list_price_mxn?: number | null
          margin_pct_12m?: number | null
          needs_review?: boolean | null
          odoo_product_id?: number
          odoo_revenue_mxn_12m?: number | null
          primary_entity_kg_id?: number | null
          product_type?: string | null
          reorder_max?: number | null
          reorder_min?: number | null
          reserved_qty?: number | null
          sat_clave_prod_serv?: string | null
          sat_clave_unidad?: string | null
          sat_line_count_12m?: number | null
          sat_revenue_mxn_12m?: number | null
          standard_price_mxn?: number | null
          stock_qty?: number | null
          top_customers_canonical_ids?: number[] | null
          top_suppliers_canonical_ids?: number[] | null
          uom?: string | null
          updated_at?: string
          weight?: number | null
        }
        Relationships: []
      }
      canonical_tax_events: {
        Row: {
          acct_ejercicio: number | null
          acct_hash: string | null
          acct_periodo: string | null
          acct_record_type: string | null
          acct_tipo_envio: string | null
          canonical_id: string
          created_at: string
          emisor_rfc: string | null
          event_type: string
          has_odoo_match: boolean | null
          last_reconciled_at: string | null
          monto_total_retenido: number | null
          needs_review: boolean | null
          odoo_account_ids: number[] | null
          odoo_payment_id: number | null
          odoo_reconciled_amount: number | null
          receptor_rfc: string | null
          reconciliation_diff_abs: number | null
          retention_fecha_emision: string | null
          retention_uuid: string | null
          return_ejercicio: number | null
          return_fecha_presentacion: string | null
          return_impuesto: string | null
          return_monto_pagado: number | null
          return_numero_operacion: string | null
          return_periodo: string | null
          return_tipo_declaracion: string | null
          review_reason: string[] | null
          sat_estado: string | null
          sat_record_id: string | null
          source_hashes: Json | null
          taxpayer_rfc: string
          tipo_retencion: string | null
          updated_at: string
        }
        Insert: {
          acct_ejercicio?: number | null
          acct_hash?: string | null
          acct_periodo?: string | null
          acct_record_type?: string | null
          acct_tipo_envio?: string | null
          canonical_id: string
          created_at?: string
          emisor_rfc?: string | null
          event_type: string
          has_odoo_match?: boolean | null
          last_reconciled_at?: string | null
          monto_total_retenido?: number | null
          needs_review?: boolean | null
          odoo_account_ids?: number[] | null
          odoo_payment_id?: number | null
          odoo_reconciled_amount?: number | null
          receptor_rfc?: string | null
          reconciliation_diff_abs?: number | null
          retention_fecha_emision?: string | null
          retention_uuid?: string | null
          return_ejercicio?: number | null
          return_fecha_presentacion?: string | null
          return_impuesto?: string | null
          return_monto_pagado?: number | null
          return_numero_operacion?: string | null
          return_periodo?: string | null
          return_tipo_declaracion?: string | null
          review_reason?: string[] | null
          sat_estado?: string | null
          sat_record_id?: string | null
          source_hashes?: Json | null
          taxpayer_rfc?: string
          tipo_retencion?: string | null
          updated_at?: string
        }
        Update: {
          acct_ejercicio?: number | null
          acct_hash?: string | null
          acct_periodo?: string | null
          acct_record_type?: string | null
          acct_tipo_envio?: string | null
          canonical_id?: string
          created_at?: string
          emisor_rfc?: string | null
          event_type?: string
          has_odoo_match?: boolean | null
          last_reconciled_at?: string | null
          monto_total_retenido?: number | null
          needs_review?: boolean | null
          odoo_account_ids?: number[] | null
          odoo_payment_id?: number | null
          odoo_reconciled_amount?: number | null
          receptor_rfc?: string | null
          reconciliation_diff_abs?: number | null
          retention_fecha_emision?: string | null
          retention_uuid?: string | null
          return_ejercicio?: number | null
          return_fecha_presentacion?: string | null
          return_impuesto?: string | null
          return_monto_pagado?: number | null
          return_numero_operacion?: string | null
          return_periodo?: string | null
          return_tipo_declaracion?: string | null
          review_reason?: string[] | null
          sat_estado?: string | null
          sat_record_id?: string | null
          source_hashes?: Json | null
          taxpayer_rfc?: string
          tipo_retencion?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          business_type: string | null
          canonical_name: string
          city: string | null
          country: string | null
          created_at: string
          credit_limit: number | null
          delivery_otd_rate: number | null
          description: string | null
          domain: string | null
          enriched_at: string | null
          enrichment_source: string | null
          entity_id: number | null
          id: number
          industry: string | null
          is_customer: boolean
          is_supplier: boolean
          key_products: Json | null
          lifetime_value: number | null
          monthly_avg: number | null
          name: string
          odoo_context: Json | null
          odoo_partner_id: number | null
          opportunity_signals: Json | null
          payment_term: string | null
          relationship_summary: string | null
          relationship_type: string | null
          rfc: string | null
          risk_signals: Json | null
          source_id: number | null
          source_ref: string | null
          strategic_notes: string | null
          supplier_payment_term: string | null
          total_credit_notes: number | null
          total_invoiced_odoo: number | null
          total_overdue_odoo: number | null
          total_payable: number | null
          total_pending: number | null
          total_receivable: number | null
          trend_pct: number | null
          updated_at: string
        }
        Insert: {
          business_type?: string | null
          canonical_name: string
          city?: string | null
          country?: string | null
          created_at?: string
          credit_limit?: number | null
          delivery_otd_rate?: number | null
          description?: string | null
          domain?: string | null
          enriched_at?: string | null
          enrichment_source?: string | null
          entity_id?: number | null
          id?: never
          industry?: string | null
          is_customer?: boolean
          is_supplier?: boolean
          key_products?: Json | null
          lifetime_value?: number | null
          monthly_avg?: number | null
          name: string
          odoo_context?: Json | null
          odoo_partner_id?: number | null
          opportunity_signals?: Json | null
          payment_term?: string | null
          relationship_summary?: string | null
          relationship_type?: string | null
          rfc?: string | null
          risk_signals?: Json | null
          source_id?: number | null
          source_ref?: string | null
          strategic_notes?: string | null
          supplier_payment_term?: string | null
          total_credit_notes?: number | null
          total_invoiced_odoo?: number | null
          total_overdue_odoo?: number | null
          total_payable?: number | null
          total_pending?: number | null
          total_receivable?: number | null
          trend_pct?: number | null
          updated_at?: string
        }
        Update: {
          business_type?: string | null
          canonical_name?: string
          city?: string | null
          country?: string | null
          created_at?: string
          credit_limit?: number | null
          delivery_otd_rate?: number | null
          description?: string | null
          domain?: string | null
          enriched_at?: string | null
          enrichment_source?: string | null
          entity_id?: number | null
          id?: never
          industry?: string | null
          is_customer?: boolean
          is_supplier?: boolean
          key_products?: Json | null
          lifetime_value?: number | null
          monthly_avg?: number | null
          name?: string
          odoo_context?: Json | null
          odoo_partner_id?: number | null
          opportunity_signals?: Json | null
          payment_term?: string | null
          relationship_summary?: string | null
          relationship_type?: string | null
          rfc?: string | null
          risk_signals?: Json | null
          source_id?: number | null
          source_ref?: string | null
          strategic_notes?: string | null
          supplier_payment_term?: string | null
          total_credit_notes?: number | null
          total_invoiced_odoo?: number | null
          total_overdue_odoo?: number | null
          total_payable?: number | null
          total_pending?: number | null
          total_receivable?: number | null
          trend_pct?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          avg_response_time_hours: number | null
          communication_style: string | null
          company_id: number | null
          contact_type: string | null
          created_at: string
          current_health_score: number | null
          decision_power: string | null
          delivery_otd_rate: number | null
          department: string | null
          email: string
          entity_id: number | null
          first_seen: string | null
          health_trend: string | null
          id: number
          influence_on_deals: string | null
          interaction_count: number | null
          is_customer: boolean | null
          is_supplier: boolean | null
          key_interests: Json | null
          language_preference: string | null
          last_activity: string | null
          lifetime_value: number | null
          name: string | null
          negotiation_style: string | null
          odoo_context: Json | null
          odoo_partner_id: number | null
          open_alerts_count: number | null
          payment_compliance_score: number | null
          pending_actions_count: number | null
          personality_notes: string | null
          relationship_score: number | null
          response_pattern: string | null
          risk_level: string | null
          role: string | null
          sentiment_score: number | null
          source_id: number | null
          source_ref: string | null
          total_credit_notes: number | null
          total_received: number | null
          total_sent: number | null
          updated_at: string
        }
        Insert: {
          avg_response_time_hours?: number | null
          communication_style?: string | null
          company_id?: number | null
          contact_type?: string | null
          created_at?: string
          current_health_score?: number | null
          decision_power?: string | null
          delivery_otd_rate?: number | null
          department?: string | null
          email: string
          entity_id?: number | null
          first_seen?: string | null
          health_trend?: string | null
          id?: never
          influence_on_deals?: string | null
          interaction_count?: number | null
          is_customer?: boolean | null
          is_supplier?: boolean | null
          key_interests?: Json | null
          language_preference?: string | null
          last_activity?: string | null
          lifetime_value?: number | null
          name?: string | null
          negotiation_style?: string | null
          odoo_context?: Json | null
          odoo_partner_id?: number | null
          open_alerts_count?: number | null
          payment_compliance_score?: number | null
          pending_actions_count?: number | null
          personality_notes?: string | null
          relationship_score?: number | null
          response_pattern?: string | null
          risk_level?: string | null
          role?: string | null
          sentiment_score?: number | null
          source_id?: number | null
          source_ref?: string | null
          total_credit_notes?: number | null
          total_received?: number | null
          total_sent?: number | null
          updated_at?: string
        }
        Update: {
          avg_response_time_hours?: number | null
          communication_style?: string | null
          company_id?: number | null
          contact_type?: string | null
          created_at?: string
          current_health_score?: number | null
          decision_power?: string | null
          delivery_otd_rate?: number | null
          department?: string | null
          email?: string
          entity_id?: number | null
          first_seen?: string | null
          health_trend?: string | null
          id?: never
          influence_on_deals?: string | null
          interaction_count?: number | null
          is_customer?: boolean | null
          is_supplier?: boolean | null
          key_interests?: Json | null
          language_preference?: string | null
          last_activity?: string | null
          lifetime_value?: number | null
          name?: string | null
          negotiation_style?: string | null
          odoo_context?: Json | null
          odoo_partner_id?: number | null
          open_alerts_count?: number | null
          payment_compliance_score?: number | null
          pending_actions_count?: number | null
          personality_notes?: string | null
          relationship_score?: number | null
          response_pattern?: string | null
          risk_level?: string | null
          role?: string | null
          sentiment_score?: number | null
          source_id?: number | null
          source_ref?: string | null
          total_credit_notes?: number | null
          total_received?: number | null
          total_sent?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
          {
            foreignKeyName: "contacts_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      data_sources: {
        Row: {
          created_at: string | null
          description: string | null
          id: number
          is_active: boolean | null
          kind: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: number
          is_active?: boolean | null
          kind: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: number
          is_active?: boolean | null
          kind?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      departments: {
        Row: {
          created_at: string | null
          description: string | null
          id: number
          is_active: boolean | null
          lead_email: string | null
          lead_name: string | null
          lead_user_id: number | null
          name: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: number
          is_active?: boolean | null
          lead_email?: string | null
          lead_name?: string | null
          lead_user_id?: number | null
          name: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: number
          is_active?: boolean | null
          lead_email?: string | null
          lead_name?: string | null
          lead_user_id?: number | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_lead_user_id_fkey"
            columns: ["lead_user_id"]
            isOneToOne: false
            referencedRelation: "odoo_users"
            referencedColumns: ["odoo_user_id"]
          },
          {
            foreignKeyName: "departments_lead_user_id_fkey"
            columns: ["lead_user_id"]
            isOneToOne: false
            referencedRelation: "salesperson_workload_30d"
            referencedColumns: ["odoo_user_id"]
          },
        ]
      }
      director_analysis_definitions: {
        Row: {
          analysis_slug: string
          created_at: string | null
          description: string | null
          director_slug: string
          execution_order: number | null
          id: number
          is_active: boolean | null
          query_sql: string
          rationale: string | null
          severity_rule: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          analysis_slug: string
          created_at?: string | null
          description?: string | null
          director_slug: string
          execution_order?: number | null
          id?: number
          is_active?: boolean | null
          query_sql: string
          rationale?: string | null
          severity_rule?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          analysis_slug?: string
          created_at?: string | null
          description?: string | null
          director_slug?: string
          execution_order?: number | null
          id?: number
          is_active?: boolean | null
          query_sql?: string
          rationale?: string | null
          severity_rule?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "director_analysis_definitions_director_slug_fkey"
            columns: ["director_slug"]
            isOneToOne: false
            referencedRelation: "agent_effectiveness"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "director_analysis_definitions_director_slug_fkey"
            columns: ["director_slug"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "director_analysis_definitions_director_slug_fkey"
            columns: ["director_slug"]
            isOneToOne: false
            referencedRelation: "director_health_30d"
            referencedColumns: ["slug"]
          },
        ]
      }
      email_cfdi_links: {
        Row: {
          account: string | null
          email_id: number | null
          gmail_message_id: string | null
          id: number
          linked_at: string
          uuid: string
        }
        Insert: {
          account?: string | null
          email_id?: number | null
          gmail_message_id?: string | null
          id?: number
          linked_at?: string
          uuid: string
        }
        Update: {
          account?: string | null
          email_id?: number | null
          gmail_message_id?: string | null
          id?: number
          linked_at?: string
          uuid?: string
        }
        Relationships: []
      }
      email_signals: {
        Row: {
          canonical_entity_id: string
          canonical_entity_type: string
          confidence: number | null
          email_id: number
          expires_at: string | null
          extracted_at: string
          id: number
          signal_type: string
          signal_value: string | null
          thread_id: number | null
        }
        Insert: {
          canonical_entity_id: string
          canonical_entity_type: string
          confidence?: number | null
          email_id: number
          expires_at?: string | null
          extracted_at?: string
          id?: number
          signal_type: string
          signal_value?: string | null
          thread_id?: number | null
        }
        Update: {
          canonical_entity_id?: string
          canonical_entity_type?: string
          confidence?: number | null
          email_id?: number
          expires_at?: string | null
          extracted_at?: string
          id?: number
          signal_type?: string
          signal_value?: string | null
          thread_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "email_signals_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_signals_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      emails: {
        Row: {
          account: string
          attachments: Json | null
          body: string | null
          company_id: number | null
          created_at: string
          email_date: string | null
          embedding: string | null
          enrichment_status: string
          gmail_message_id: string
          gmail_thread_id: string | null
          has_attachments: boolean | null
          id: number
          is_reply: boolean | null
          kg_processed: boolean | null
          recipient: string | null
          sender: string
          sender_contact_id: number | null
          sender_type: string | null
          snippet: string | null
          subject: string | null
          thread_id: number | null
          updated_at: string
        }
        Insert: {
          account: string
          attachments?: Json | null
          body?: string | null
          company_id?: number | null
          created_at?: string
          email_date?: string | null
          embedding?: string | null
          enrichment_status?: string
          gmail_message_id: string
          gmail_thread_id?: string | null
          has_attachments?: boolean | null
          id?: never
          is_reply?: boolean | null
          kg_processed?: boolean | null
          recipient?: string | null
          sender: string
          sender_contact_id?: number | null
          sender_type?: string | null
          snippet?: string | null
          subject?: string | null
          thread_id?: number | null
          updated_at?: string
        }
        Update: {
          account?: string
          attachments?: Json | null
          body?: string | null
          company_id?: number | null
          created_at?: string
          email_date?: string | null
          embedding?: string | null
          enrichment_status?: string
          gmail_message_id?: string
          gmail_thread_id?: string | null
          has_attachments?: boolean | null
          id?: never
          is_reply?: boolean | null
          kg_processed?: boolean | null
          recipient?: string | null
          sender?: string
          sender_contact_id?: number | null
          sender_type?: string | null
          snippet?: string | null
          subject?: string | null
          thread_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "emails_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "emails_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "emails_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
          {
            foreignKeyName: "emails_sender_contact_id_fkey"
            columns: ["sender_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          attributes: Json | null
          canonical_name: string
          created_at: string
          email: string | null
          entity_type: string
          first_seen: string | null
          id: number
          last_seen: string | null
          mention_count: number | null
          name: string
          odoo_id: number | null
          odoo_model: string | null
          updated_at: string
        }
        Insert: {
          attributes?: Json | null
          canonical_name: string
          created_at?: string
          email?: string | null
          entity_type: string
          first_seen?: string | null
          id?: never
          last_seen?: string | null
          mention_count?: number | null
          name: string
          odoo_id?: number | null
          odoo_model?: string | null
          updated_at?: string
        }
        Update: {
          attributes?: Json | null
          canonical_name?: string
          created_at?: string
          email?: string | null
          entity_type?: string
          first_seen?: string | null
          id?: never
          last_seen?: string | null
          mention_count?: number | null
          name?: string
          odoo_id?: number | null
          odoo_model?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      entity_relationships: {
        Row: {
          context: string | null
          created_at: string
          entity_a_id: number
          entity_b_id: number
          first_seen: string | null
          id: number
          interaction_count: number | null
          last_seen: string | null
          relationship_type: string
          strength: number | null
          updated_at: string
        }
        Insert: {
          context?: string | null
          created_at?: string
          entity_a_id: number
          entity_b_id: number
          first_seen?: string | null
          id?: never
          interaction_count?: number | null
          last_seen?: string | null
          relationship_type: string
          strength?: number | null
          updated_at?: string
        }
        Update: {
          context?: string | null
          created_at?: string
          entity_a_id?: number
          entity_b_id?: number
          first_seen?: string | null
          id?: never
          interaction_count?: number | null
          last_seen?: string | null
          relationship_type?: string
          strength?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_relationships_entity_a_id_fkey"
            columns: ["entity_a_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_relationships_entity_b_id_fkey"
            columns: ["entity_b_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      facts: {
        Row: {
          confidence: number
          created_at: string
          entity_id: number
          expired: boolean | null
          extracted_at: string | null
          fact_date: string | null
          fact_hash: string | null
          fact_text: string
          fact_type: string
          id: number
          is_future: boolean | null
          source_account: string | null
          source_id: number | null
          source_type: string | null
          verification_date: string | null
          verification_source: string | null
          verified: boolean | null
        }
        Insert: {
          confidence?: number
          created_at?: string
          entity_id: number
          expired?: boolean | null
          extracted_at?: string | null
          fact_date?: string | null
          fact_hash?: string | null
          fact_text: string
          fact_type: string
          id?: never
          is_future?: boolean | null
          source_account?: string | null
          source_id?: number | null
          source_type?: string | null
          verification_date?: string | null
          verification_source?: string | null
          verified?: boolean | null
        }
        Update: {
          confidence?: number
          created_at?: string
          entity_id?: number
          expired?: boolean | null
          extracted_at?: string | null
          fact_date?: string | null
          fact_hash?: string | null
          fact_text?: string
          fact_type?: string
          id?: never
          is_future?: boolean | null
          source_account?: string | null
          source_id?: number | null
          source_type?: string | null
          verification_date?: string | null
          verification_source?: string | null
          verified?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "facts_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facts_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_follow_ups: {
        Row: {
          assignee_email: string | null
          assignee_name: string | null
          category: string | null
          company_id: number | null
          created_at: string | null
          follow_up_date: string
          id: number
          insight_id: number
          original_title: string
          resolution_note: string | null
          resolved_at: string | null
          snapshot_at_action: Json | null
          status: string | null
        }
        Insert: {
          assignee_email?: string | null
          assignee_name?: string | null
          category?: string | null
          company_id?: number | null
          created_at?: string | null
          follow_up_date: string
          id?: number
          insight_id: number
          original_title: string
          resolution_note?: string | null
          resolved_at?: string | null
          snapshot_at_action?: Json | null
          status?: string | null
        }
        Update: {
          assignee_email?: string | null
          assignee_name?: string | null
          category?: string | null
          company_id?: number | null
          created_at?: string | null
          follow_up_date?: string
          id?: number
          insight_id?: number
          original_title?: string
          resolution_note?: string | null
          resolved_at?: string | null
          snapshot_at_action?: Json | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insight_follow_ups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_follow_ups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "insight_follow_ups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "insight_follow_ups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
          {
            foreignKeyName: "insight_follow_ups_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: true
            referencedRelation: "agent_insights"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_routing: {
        Row: {
          category_pattern: string
          created_at: string | null
          department_id: number | null
          id: number
          is_active: boolean | null
          priority: number | null
        }
        Insert: {
          category_pattern: string
          created_at?: string | null
          department_id?: number | null
          id?: number
          is_active?: boolean | null
          priority?: number | null
        }
        Update: {
          category_pattern?: string
          created_at?: string | null
          department_id?: number | null
          id?: number
          is_active?: boolean | null
          priority?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "insight_routing_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      invariant_routing: {
        Row: {
          canonical_contact_id: number | null
          department_name: string
          invariant_namespace: string
          updated_at: string
        }
        Insert: {
          canonical_contact_id?: number | null
          department_name: string
          invariant_namespace: string
          updated_at?: string
        }
        Update: {
          canonical_contact_id?: number | null
          department_name?: string
          invariant_namespace?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invariant_routing_canonical_contact_id_fkey"
            columns: ["canonical_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invariant_routing_canonical_contact_id_fkey"
            columns: ["canonical_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_crm_leads"
            referencedColumns: ["assignee_canonical_contact_id"]
          },
          {
            foreignKeyName: "invariant_routing_canonical_contact_id_fkey"
            columns: ["canonical_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_employees"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "invariant_routing_canonical_contact_id_fkey"
            columns: ["canonical_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_purchase_orders"
            referencedColumns: ["buyer_canonical_contact_id"]
          },
          {
            foreignKeyName: "invariant_routing_canonical_contact_id_fkey"
            columns: ["canonical_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_sale_orders"
            referencedColumns: ["salesperson_canonical_contact_id"]
          },
        ]
      }
      manual_notes: {
        Row: {
          body: string
          canonical_entity_id: string
          canonical_entity_type: string
          created_at: string
          created_by: string
          id: number
          note_type: string
          pinned: boolean
          updated_at: string
        }
        Insert: {
          body: string
          canonical_entity_id: string
          canonical_entity_type: string
          created_at?: string
          created_by: string
          id?: number
          note_type?: string
          pinned?: boolean
          updated_at?: string
        }
        Update: {
          body?: string
          canonical_entity_id?: string
          canonical_entity_type?: string
          created_at?: string
          created_by?: string
          id?: number
          note_type?: string
          pinned?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      mdm_manual_overrides: {
        Row: {
          action: string | null
          canonical_id: string
          created_at: string
          entity_type: string
          expires_at: string | null
          id: number
          is_active: boolean
          linked_at: string
          linked_by: string | null
          note: string | null
          override_field: string
          override_source: string
          override_value: string
          payload: Json | null
          revoke_reason: string | null
          source_link_id: number | null
        }
        Insert: {
          action?: string | null
          canonical_id: string
          created_at?: string
          entity_type: string
          expires_at?: string | null
          id?: number
          is_active?: boolean
          linked_at?: string
          linked_by?: string | null
          note?: string | null
          override_field: string
          override_source?: string
          override_value: string
          payload?: Json | null
          revoke_reason?: string | null
          source_link_id?: number | null
        }
        Update: {
          action?: string | null
          canonical_id?: string
          created_at?: string
          entity_type?: string
          expires_at?: string | null
          id?: number
          is_active?: boolean
          linked_at?: string
          linked_by?: string | null
          note?: string | null
          override_field?: string
          override_source?: string
          override_value?: string
          payload?: Json | null
          revoke_reason?: string | null
          source_link_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mdm_manual_overrides_source_link_id_fkey"
            columns: ["source_link_id"]
            isOneToOne: false
            referencedRelation: "source_links"
            referencedColumns: ["id"]
          },
        ]
      }
      mrp_bom_lines: {
        Row: {
          id: number
          odoo_bom_id: number
          odoo_bom_line_id: number
          odoo_product_id: number | null
          product_name: string | null
          product_qty: number
          product_ref: string | null
          product_uom: string | null
          synced_at: string | null
        }
        Insert: {
          id?: number
          odoo_bom_id: number
          odoo_bom_line_id: number
          odoo_product_id?: number | null
          product_name?: string | null
          product_qty?: number
          product_ref?: string | null
          product_uom?: string | null
          synced_at?: string | null
        }
        Update: {
          id?: number
          odoo_bom_id?: number
          odoo_bom_line_id?: number
          odoo_product_id?: number | null
          product_name?: string | null
          product_qty?: number
          product_ref?: string | null
          product_uom?: string | null
          synced_at?: string | null
        }
        Relationships: []
      }
      mrp_boms: {
        Row: {
          active: boolean | null
          bom_type: string | null
          code: string | null
          id: number
          odoo_bom_id: number
          odoo_company_id: number | null
          odoo_product_id: number | null
          odoo_product_tmpl_id: number | null
          product_name: string | null
          product_qty: number
          product_ref: string | null
          product_uom: string | null
          synced_at: string | null
        }
        Insert: {
          active?: boolean | null
          bom_type?: string | null
          code?: string | null
          id?: number
          odoo_bom_id: number
          odoo_company_id?: number | null
          odoo_product_id?: number | null
          odoo_product_tmpl_id?: number | null
          product_name?: string | null
          product_qty?: number
          product_ref?: string | null
          product_uom?: string | null
          synced_at?: string | null
        }
        Update: {
          active?: boolean | null
          bom_type?: string | null
          code?: string | null
          id?: number
          odoo_bom_id?: number
          odoo_company_id?: number | null
          odoo_product_id?: number | null
          odoo_product_tmpl_id?: number | null
          product_name?: string | null
          product_qty?: number
          product_ref?: string | null
          product_uom?: string | null
          synced_at?: string | null
        }
        Relationships: []
      }
      odoo_account_balances: {
        Row: {
          account_code: string | null
          account_name: string | null
          account_type: string | null
          balance: number | null
          credit: number | null
          debit: number | null
          id: number
          odoo_account_id: number
          period: string | null
          synced_at: string | null
        }
        Insert: {
          account_code?: string | null
          account_name?: string | null
          account_type?: string | null
          balance?: number | null
          credit?: number | null
          debit?: number | null
          id?: number
          odoo_account_id: number
          period?: string | null
          synced_at?: string | null
        }
        Update: {
          account_code?: string | null
          account_name?: string | null
          account_type?: string | null
          balance?: number | null
          credit?: number | null
          debit?: number | null
          id?: number
          odoo_account_id?: number
          period?: string | null
          synced_at?: string | null
        }
        Relationships: []
      }
      odoo_account_payments: {
        Row: {
          amount: number | null
          amount_signed: number | null
          company_id: number | null
          currency: string | null
          date: string | null
          id: number
          is_matched: boolean | null
          is_reconciled: boolean | null
          journal_name: string | null
          name: string | null
          odoo_company_id: number | null
          odoo_partner_id: number | null
          odoo_payment_id: number
          partner_type: string | null
          payment_method: string | null
          payment_type: string | null
          reconciled_invoices_count: number | null
          ref: string | null
          state: string | null
          synced_at: string | null
        }
        Insert: {
          amount?: number | null
          amount_signed?: number | null
          company_id?: number | null
          currency?: string | null
          date?: string | null
          id?: number
          is_matched?: boolean | null
          is_reconciled?: boolean | null
          journal_name?: string | null
          name?: string | null
          odoo_company_id?: number | null
          odoo_partner_id?: number | null
          odoo_payment_id: number
          partner_type?: string | null
          payment_method?: string | null
          payment_type?: string | null
          reconciled_invoices_count?: number | null
          ref?: string | null
          state?: string | null
          synced_at?: string | null
        }
        Update: {
          amount?: number | null
          amount_signed?: number | null
          company_id?: number | null
          currency?: string | null
          date?: string | null
          id?: number
          is_matched?: boolean | null
          is_reconciled?: boolean | null
          journal_name?: string | null
          name?: string | null
          odoo_company_id?: number | null
          odoo_partner_id?: number | null
          odoo_payment_id?: number
          partner_type?: string | null
          payment_method?: string | null
          payment_type?: string | null
          reconciled_invoices_count?: number | null
          ref?: string | null
          state?: string | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "odoo_account_payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odoo_account_payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_account_payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_account_payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
        ]
      }
      odoo_activities: {
        Row: {
          activity_type: string
          assigned_to: string | null
          company_id: number | null
          date_deadline: string | null
          id: number
          is_overdue: boolean | null
          odoo_partner_id: number | null
          res_id: number | null
          res_model: string
          summary: string | null
          synced_at: string
        }
        Insert: {
          activity_type?: string
          assigned_to?: string | null
          company_id?: number | null
          date_deadline?: string | null
          id?: never
          is_overdue?: boolean | null
          odoo_partner_id?: number | null
          res_id?: number | null
          res_model: string
          summary?: string | null
          synced_at?: string
        }
        Update: {
          activity_type?: string
          assigned_to?: string | null
          company_id?: number | null
          date_deadline?: string | null
          id?: never
          is_overdue?: boolean | null
          odoo_partner_id?: number | null
          res_id?: number | null
          res_model?: string
          summary?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "odoo_activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odoo_activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
        ]
      }
      odoo_bank_balances: {
        Row: {
          bank_account: string | null
          company_name: string | null
          currency: string | null
          current_balance: number | null
          current_balance_mxn: number | null
          id: number
          journal_type: string | null
          name: string | null
          odoo_company_id: number | null
          odoo_journal_id: number
          updated_at: string | null
        }
        Insert: {
          bank_account?: string | null
          company_name?: string | null
          currency?: string | null
          current_balance?: number | null
          current_balance_mxn?: number | null
          id?: number
          journal_type?: string | null
          name?: string | null
          odoo_company_id?: number | null
          odoo_journal_id: number
          updated_at?: string | null
        }
        Update: {
          bank_account?: string | null
          company_name?: string | null
          currency?: string | null
          current_balance?: number | null
          current_balance_mxn?: number | null
          id?: number
          journal_type?: string | null
          name?: string | null
          odoo_company_id?: number | null
          odoo_journal_id?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      odoo_chart_of_accounts: {
        Row: {
          account_type: string | null
          active: boolean | null
          code: string
          deprecated: boolean | null
          id: number
          name: string
          odoo_account_id: number
          odoo_company_id: number | null
          reconcile: boolean | null
          synced_at: string | null
        }
        Insert: {
          account_type?: string | null
          active?: boolean | null
          code: string
          deprecated?: boolean | null
          id?: number
          name: string
          odoo_account_id: number
          odoo_company_id?: number | null
          reconcile?: boolean | null
          synced_at?: string | null
        }
        Update: {
          account_type?: string | null
          active?: boolean | null
          code?: string
          deprecated?: boolean | null
          id?: number
          name?: string
          odoo_account_id?: number
          odoo_company_id?: number | null
          reconcile?: boolean | null
          synced_at?: string | null
        }
        Relationships: []
      }
      odoo_crm_leads: {
        Row: {
          active: boolean | null
          assigned_user: string | null
          company_id: number | null
          create_date: string | null
          date_deadline: string | null
          days_open: number | null
          expected_revenue: number | null
          id: number
          lead_type: string
          name: string
          odoo_company_id: number | null
          odoo_lead_id: number
          odoo_partner_id: number | null
          probability: number | null
          stage: string | null
          synced_at: string
        }
        Insert: {
          active?: boolean | null
          assigned_user?: string | null
          company_id?: number | null
          create_date?: string | null
          date_deadline?: string | null
          days_open?: number | null
          expected_revenue?: number | null
          id?: never
          lead_type: string
          name: string
          odoo_company_id?: number | null
          odoo_lead_id: number
          odoo_partner_id?: number | null
          probability?: number | null
          stage?: string | null
          synced_at?: string
        }
        Update: {
          active?: boolean | null
          assigned_user?: string | null
          company_id?: number | null
          create_date?: string | null
          date_deadline?: string | null
          days_open?: number | null
          expected_revenue?: number | null
          id?: never
          lead_type?: string
          name?: string
          odoo_company_id?: number | null
          odoo_lead_id?: number
          odoo_partner_id?: number | null
          probability?: number | null
          stage?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "odoo_crm_leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odoo_crm_leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_crm_leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_crm_leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
        ]
      }
      odoo_currency_rates: {
        Row: {
          currency: string
          id: number
          inverse_rate: number | null
          odoo_company_id: number | null
          rate: number
          rate_date: string
          synced_at: string | null
        }
        Insert: {
          currency: string
          id?: number
          inverse_rate?: number | null
          odoo_company_id?: number | null
          rate: number
          rate_date: string
          synced_at?: string | null
        }
        Update: {
          currency?: string
          id?: number
          inverse_rate?: number | null
          odoo_company_id?: number | null
          rate?: number
          rate_date?: string
          synced_at?: string | null
        }
        Relationships: []
      }
      odoo_deliveries: {
        Row: {
          company_id: number | null
          create_date: string | null
          date_done: string | null
          id: number
          is_late: boolean | null
          lead_time_days: number | null
          name: string
          odoo_company_id: number | null
          odoo_partner_id: number
          odoo_picking_id: number | null
          origin: string | null
          picking_type: string | null
          picking_type_code: string | null
          scheduled_date: string | null
          state: string
          synced_at: string
        }
        Insert: {
          company_id?: number | null
          create_date?: string | null
          date_done?: string | null
          id?: never
          is_late?: boolean | null
          lead_time_days?: number | null
          name: string
          odoo_company_id?: number | null
          odoo_partner_id: number
          odoo_picking_id?: number | null
          origin?: string | null
          picking_type?: string | null
          picking_type_code?: string | null
          scheduled_date?: string | null
          state?: string
          synced_at?: string
        }
        Update: {
          company_id?: number | null
          create_date?: string | null
          date_done?: string | null
          id?: never
          is_late?: boolean | null
          lead_time_days?: number | null
          name?: string
          odoo_company_id?: number | null
          odoo_partner_id?: number
          odoo_picking_id?: number | null
          origin?: string | null
          picking_type?: string | null
          picking_type_code?: string | null
          scheduled_date?: string | null
          state?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "odoo_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odoo_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
        ]
      }
      odoo_departments: {
        Row: {
          id: number
          manager_id: number | null
          manager_name: string | null
          member_count: number | null
          name: string
          odoo_company_id: number | null
          odoo_department_id: number
          parent_id: number | null
          parent_name: string | null
          synced_at: string | null
        }
        Insert: {
          id?: number
          manager_id?: number | null
          manager_name?: string | null
          member_count?: number | null
          name: string
          odoo_company_id?: number | null
          odoo_department_id: number
          parent_id?: number | null
          parent_name?: string | null
          synced_at?: string | null
        }
        Update: {
          id?: number
          manager_id?: number | null
          manager_name?: string | null
          member_count?: number | null
          name?: string
          odoo_company_id?: number | null
          odoo_department_id?: number
          parent_id?: number | null
          parent_name?: string | null
          synced_at?: string | null
        }
        Relationships: []
      }
      odoo_employees: {
        Row: {
          coach_name: string | null
          department_id: number | null
          department_name: string | null
          id: number
          is_active: boolean | null
          job_name: string | null
          job_title: string | null
          manager_id: number | null
          manager_name: string | null
          name: string
          odoo_company_id: number | null
          odoo_employee_id: number
          odoo_user_id: number | null
          synced_at: string | null
          work_email: string | null
          work_phone: string | null
        }
        Insert: {
          coach_name?: string | null
          department_id?: number | null
          department_name?: string | null
          id?: number
          is_active?: boolean | null
          job_name?: string | null
          job_title?: string | null
          manager_id?: number | null
          manager_name?: string | null
          name: string
          odoo_company_id?: number | null
          odoo_employee_id: number
          odoo_user_id?: number | null
          synced_at?: string | null
          work_email?: string | null
          work_phone?: string | null
        }
        Update: {
          coach_name?: string | null
          department_id?: number | null
          department_name?: string | null
          id?: number
          is_active?: boolean | null
          job_name?: string | null
          job_title?: string | null
          manager_id?: number | null
          manager_name?: string | null
          name?: string
          odoo_company_id?: number | null
          odoo_employee_id?: number
          odoo_user_id?: number | null
          synced_at?: string | null
          work_email?: string | null
          work_phone?: string | null
        }
        Relationships: []
      }
      odoo_invoice_lines: {
        Row: {
          company_id: number | null
          currency: string | null
          discount: number | null
          id: number
          invoice_date: string | null
          line_uom: string | null
          line_uom_id: number | null
          move_name: string | null
          move_type: string | null
          odoo_company_id: number | null
          odoo_line_id: number
          odoo_move_id: number | null
          odoo_partner_id: number | null
          odoo_product_id: number | null
          price_subtotal: number | null
          price_subtotal_mxn: number | null
          price_total: number | null
          price_total_mxn: number | null
          price_unit: number | null
          product_name: string | null
          product_ref: string | null
          quantity: number | null
          synced_at: string | null
        }
        Insert: {
          company_id?: number | null
          currency?: string | null
          discount?: number | null
          id?: number
          invoice_date?: string | null
          line_uom?: string | null
          line_uom_id?: number | null
          move_name?: string | null
          move_type?: string | null
          odoo_company_id?: number | null
          odoo_line_id: number
          odoo_move_id?: number | null
          odoo_partner_id?: number | null
          odoo_product_id?: number | null
          price_subtotal?: number | null
          price_subtotal_mxn?: number | null
          price_total?: number | null
          price_total_mxn?: number | null
          price_unit?: number | null
          product_name?: string | null
          product_ref?: string | null
          quantity?: number | null
          synced_at?: string | null
        }
        Update: {
          company_id?: number | null
          currency?: string | null
          discount?: number | null
          id?: number
          invoice_date?: string | null
          line_uom?: string | null
          line_uom_id?: number | null
          move_name?: string | null
          move_type?: string | null
          odoo_company_id?: number | null
          odoo_line_id?: number
          odoo_move_id?: number | null
          odoo_partner_id?: number | null
          odoo_product_id?: number | null
          price_subtotal?: number | null
          price_subtotal_mxn?: number | null
          price_total?: number | null
          price_total_mxn?: number | null
          price_unit?: number | null
          product_name?: string | null
          product_ref?: string | null
          quantity?: number | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "odoo_invoice_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odoo_invoice_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_invoice_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_invoice_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
        ]
      }
      odoo_invoices: {
        Row: {
          amount_paid: number | null
          amount_residual: number
          amount_residual_mxn: number | null
          amount_tax: number | null
          amount_total: number
          amount_total_mxn: number | null
          amount_untaxed: number | null
          amount_untaxed_mxn: number | null
          cfdi_sat_state: string | null
          cfdi_state: string | null
          cfdi_uuid: string | null
          company_id: number | null
          currency: string | null
          days_overdue: number | null
          days_to_pay: number | null
          due_date: string | null
          edi_state: string | null
          id: number
          invoice_date: string | null
          move_type: string
          name: string
          odoo_company_id: number | null
          odoo_invoice_id: number
          odoo_partner_id: number
          payment_date: string | null
          payment_state: string | null
          payment_status: string | null
          payment_term: string | null
          ref: string | null
          reversed_entry_id: number | null
          salesperson_name: string | null
          salesperson_user_id: number | null
          state: string
          synced_at: string
          write_date: string | null
        }
        Insert: {
          amount_paid?: number | null
          amount_residual?: number
          amount_residual_mxn?: number | null
          amount_tax?: number | null
          amount_total?: number
          amount_total_mxn?: number | null
          amount_untaxed?: number | null
          amount_untaxed_mxn?: number | null
          cfdi_sat_state?: string | null
          cfdi_state?: string | null
          cfdi_uuid?: string | null
          company_id?: number | null
          currency?: string | null
          days_overdue?: number | null
          days_to_pay?: number | null
          due_date?: string | null
          edi_state?: string | null
          id?: never
          invoice_date?: string | null
          move_type: string
          name: string
          odoo_company_id?: number | null
          odoo_invoice_id: number
          odoo_partner_id: number
          payment_date?: string | null
          payment_state?: string | null
          payment_status?: string | null
          payment_term?: string | null
          ref?: string | null
          reversed_entry_id?: number | null
          salesperson_name?: string | null
          salesperson_user_id?: number | null
          state?: string
          synced_at?: string
          write_date?: string | null
        }
        Update: {
          amount_paid?: number | null
          amount_residual?: number
          amount_residual_mxn?: number | null
          amount_tax?: number | null
          amount_total?: number
          amount_total_mxn?: number | null
          amount_untaxed?: number | null
          amount_untaxed_mxn?: number | null
          cfdi_sat_state?: string | null
          cfdi_state?: string | null
          cfdi_uuid?: string | null
          company_id?: number | null
          currency?: string | null
          days_overdue?: number | null
          days_to_pay?: number | null
          due_date?: string | null
          edi_state?: string | null
          id?: never
          invoice_date?: string | null
          move_type?: string
          name?: string
          odoo_company_id?: number | null
          odoo_invoice_id?: number
          odoo_partner_id?: number
          payment_date?: string | null
          payment_state?: string | null
          payment_status?: string | null
          payment_term?: string | null
          ref?: string | null
          reversed_entry_id?: number | null
          salesperson_name?: string | null
          salesperson_user_id?: number | null
          state?: string
          synced_at?: string
          write_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "odoo_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odoo_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
        ]
      }
      odoo_manufacturing: {
        Row: {
          assigned_user: string | null
          create_date: string | null
          date_finished: string | null
          date_start: string | null
          id: number
          name: string | null
          odoo_company_id: number | null
          odoo_product_id: number | null
          odoo_production_id: number
          origin: string | null
          product_name: string | null
          qty_planned: number | null
          qty_produced: number | null
          state: string | null
          synced_at: string | null
        }
        Insert: {
          assigned_user?: string | null
          create_date?: string | null
          date_finished?: string | null
          date_start?: string | null
          id?: never
          name?: string | null
          odoo_company_id?: number | null
          odoo_product_id?: number | null
          odoo_production_id: number
          origin?: string | null
          product_name?: string | null
          qty_planned?: number | null
          qty_produced?: number | null
          state?: string | null
          synced_at?: string | null
        }
        Update: {
          assigned_user?: string | null
          create_date?: string | null
          date_finished?: string | null
          date_start?: string | null
          id?: never
          name?: string | null
          odoo_company_id?: number | null
          odoo_product_id?: number | null
          odoo_production_id?: number
          origin?: string | null
          product_name?: string | null
          qty_planned?: number | null
          qty_produced?: number | null
          state?: string | null
          synced_at?: string | null
        }
        Relationships: []
      }
      odoo_order_lines: {
        Row: {
          company_id: number | null
          currency: string | null
          discount: number | null
          id: number
          line_uom: string | null
          line_uom_id: number | null
          odoo_company_id: number | null
          odoo_line_id: number | null
          odoo_order_id: number
          odoo_partner_id: number
          odoo_product_id: number | null
          order_date: string | null
          order_name: string
          order_state: string | null
          order_type: string
          price_unit: number
          product_name: string
          product_ref: string | null
          qty: number
          qty_delivered: number | null
          qty_invoiced: number | null
          salesperson_name: string | null
          subtotal: number
          subtotal_mxn: number | null
        }
        Insert: {
          company_id?: number | null
          currency?: string | null
          discount?: number | null
          id?: never
          line_uom?: string | null
          line_uom_id?: number | null
          odoo_company_id?: number | null
          odoo_line_id?: number | null
          odoo_order_id: number
          odoo_partner_id: number
          odoo_product_id?: number | null
          order_date?: string | null
          order_name: string
          order_state?: string | null
          order_type: string
          price_unit: number
          product_name: string
          product_ref?: string | null
          qty: number
          qty_delivered?: number | null
          qty_invoiced?: number | null
          salesperson_name?: string | null
          subtotal: number
          subtotal_mxn?: number | null
        }
        Update: {
          company_id?: number | null
          currency?: string | null
          discount?: number | null
          id?: never
          line_uom?: string | null
          line_uom_id?: number | null
          odoo_company_id?: number | null
          odoo_line_id?: number | null
          odoo_order_id?: number
          odoo_partner_id?: number
          odoo_product_id?: number | null
          order_date?: string | null
          order_name?: string
          order_state?: string | null
          order_type?: string
          price_unit?: number
          product_name?: string
          product_ref?: string | null
          qty?: number
          qty_delivered?: number | null
          qty_invoiced?: number | null
          salesperson_name?: string | null
          subtotal?: number
          subtotal_mxn?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "odoo_order_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odoo_order_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_order_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_order_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
        ]
      }
      odoo_orderpoints: {
        Row: {
          active: boolean | null
          id: number
          location_name: string | null
          odoo_company_id: number | null
          odoo_orderpoint_id: number
          odoo_product_id: number | null
          product_max_qty: number | null
          product_min_qty: number | null
          product_name: string | null
          qty_forecast: number | null
          qty_on_hand: number | null
          qty_to_order: number | null
          synced_at: string | null
          trigger_type: string | null
          warehouse_name: string | null
        }
        Insert: {
          active?: boolean | null
          id?: number
          location_name?: string | null
          odoo_company_id?: number | null
          odoo_orderpoint_id: number
          odoo_product_id?: number | null
          product_max_qty?: number | null
          product_min_qty?: number | null
          product_name?: string | null
          qty_forecast?: number | null
          qty_on_hand?: number | null
          qty_to_order?: number | null
          synced_at?: string | null
          trigger_type?: string | null
          warehouse_name?: string | null
        }
        Update: {
          active?: boolean | null
          id?: number
          location_name?: string | null
          odoo_company_id?: number | null
          odoo_orderpoint_id?: number
          odoo_product_id?: number | null
          product_max_qty?: number | null
          product_min_qty?: number | null
          product_name?: string | null
          qty_forecast?: number | null
          qty_on_hand?: number | null
          qty_to_order?: number | null
          synced_at?: string | null
          trigger_type?: string | null
          warehouse_name?: string | null
        }
        Relationships: []
      }
      odoo_products: {
        Row: {
          active: boolean | null
          available_qty: number | null
          avg_cost: number | null
          barcode: string | null
          category: string | null
          category_id: number | null
          id: number
          internal_ref: string | null
          list_price: number | null
          name: string
          odoo_company_id: number | null
          odoo_product_id: number
          product_type: string | null
          reorder_max: number | null
          reorder_min: number | null
          reserved_qty: number | null
          standard_price: number | null
          stock_qty: number | null
          uom: string
          uom_id: number | null
          updated_at: string
          weight: number | null
        }
        Insert: {
          active?: boolean | null
          available_qty?: number | null
          avg_cost?: number | null
          barcode?: string | null
          category?: string | null
          category_id?: number | null
          id?: never
          internal_ref?: string | null
          list_price?: number | null
          name: string
          odoo_company_id?: number | null
          odoo_product_id: number
          product_type?: string | null
          reorder_max?: number | null
          reorder_min?: number | null
          reserved_qty?: number | null
          standard_price?: number | null
          stock_qty?: number | null
          uom?: string
          uom_id?: number | null
          updated_at?: string
          weight?: number | null
        }
        Update: {
          active?: boolean | null
          available_qty?: number | null
          avg_cost?: number | null
          barcode?: string | null
          category?: string | null
          category_id?: number | null
          id?: never
          internal_ref?: string | null
          list_price?: number | null
          name?: string
          odoo_company_id?: number | null
          odoo_product_id?: number
          product_type?: string | null
          reorder_max?: number | null
          reorder_min?: number | null
          reserved_qty?: number | null
          standard_price?: number | null
          stock_qty?: number | null
          uom?: string
          uom_id?: number | null
          updated_at?: string
          weight?: number | null
        }
        Relationships: []
      }
      odoo_purchase_orders: {
        Row: {
          amount_total: number | null
          amount_total_mxn: number | null
          amount_untaxed: number | null
          amount_untaxed_mxn: number | null
          buyer_email: string | null
          buyer_name: string | null
          buyer_user_id: number | null
          company_id: number | null
          create_date: string | null
          currency: string | null
          date_approve: string | null
          date_order: string | null
          id: number
          name: string
          odoo_company_id: number | null
          odoo_order_id: number
          odoo_partner_id: number | null
          state: string | null
          synced_at: string | null
        }
        Insert: {
          amount_total?: number | null
          amount_total_mxn?: number | null
          amount_untaxed?: number | null
          amount_untaxed_mxn?: number | null
          buyer_email?: string | null
          buyer_name?: string | null
          buyer_user_id?: number | null
          company_id?: number | null
          create_date?: string | null
          currency?: string | null
          date_approve?: string | null
          date_order?: string | null
          id?: number
          name: string
          odoo_company_id?: number | null
          odoo_order_id: number
          odoo_partner_id?: number | null
          state?: string | null
          synced_at?: string | null
        }
        Update: {
          amount_total?: number | null
          amount_total_mxn?: number | null
          amount_untaxed?: number | null
          amount_untaxed_mxn?: number | null
          buyer_email?: string | null
          buyer_name?: string | null
          buyer_user_id?: number | null
          company_id?: number | null
          create_date?: string | null
          currency?: string | null
          date_approve?: string | null
          date_order?: string | null
          id?: number
          name?: string
          odoo_company_id?: number | null
          odoo_order_id?: number
          odoo_partner_id?: number | null
          state?: string | null
          synced_at?: string | null
        }
        Relationships: []
      }
      odoo_sale_orders: {
        Row: {
          amount_total: number | null
          amount_total_mxn: number | null
          amount_untaxed: number | null
          amount_untaxed_mxn: number | null
          commitment_date: string | null
          company_id: number | null
          create_date: string | null
          currency: string | null
          date_order: string | null
          id: number
          margin: number | null
          margin_percent: number | null
          name: string
          odoo_company_id: number | null
          odoo_order_id: number
          odoo_partner_id: number | null
          salesperson_email: string | null
          salesperson_name: string | null
          salesperson_user_id: number | null
          state: string | null
          synced_at: string | null
          team_name: string | null
        }
        Insert: {
          amount_total?: number | null
          amount_total_mxn?: number | null
          amount_untaxed?: number | null
          amount_untaxed_mxn?: number | null
          commitment_date?: string | null
          company_id?: number | null
          create_date?: string | null
          currency?: string | null
          date_order?: string | null
          id?: number
          margin?: number | null
          margin_percent?: number | null
          name: string
          odoo_company_id?: number | null
          odoo_order_id: number
          odoo_partner_id?: number | null
          salesperson_email?: string | null
          salesperson_name?: string | null
          salesperson_user_id?: number | null
          state?: string | null
          synced_at?: string | null
          team_name?: string | null
        }
        Update: {
          amount_total?: number | null
          amount_total_mxn?: number | null
          amount_untaxed?: number | null
          amount_untaxed_mxn?: number | null
          commitment_date?: string | null
          company_id?: number | null
          create_date?: string | null
          currency?: string | null
          date_order?: string | null
          id?: number
          margin?: number | null
          margin_percent?: number | null
          name?: string
          odoo_company_id?: number | null
          odoo_order_id?: number
          odoo_partner_id?: number | null
          salesperson_email?: string | null
          salesperson_name?: string | null
          salesperson_user_id?: number | null
          state?: string | null
          synced_at?: string | null
          team_name?: string | null
        }
        Relationships: []
      }
      odoo_users: {
        Row: {
          activities_json: Json | null
          department: string | null
          email: string | null
          id: number
          job_title: string | null
          name: string
          odoo_company_id: number | null
          odoo_user_id: number
          overdue_activities_count: number | null
          pending_activities_count: number | null
          updated_at: string
        }
        Insert: {
          activities_json?: Json | null
          department?: string | null
          email?: string | null
          id?: never
          job_title?: string | null
          name: string
          odoo_company_id?: number | null
          odoo_user_id: number
          overdue_activities_count?: number | null
          pending_activities_count?: number | null
          updated_at?: string
        }
        Update: {
          activities_json?: Json | null
          department?: string | null
          email?: string | null
          id?: never
          job_title?: string | null
          name?: string
          odoo_company_id?: number | null
          odoo_user_id?: number
          overdue_activities_count?: number | null
          pending_activities_count?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      pipeline_logs: {
        Row: {
          created_at: string
          details: Json | null
          id: string
          level: string
          message: string | null
          phase: string | null
        }
        Insert: {
          created_at?: string
          details?: Json | null
          id?: string
          level?: string
          message?: string | null
          phase?: string | null
        }
        Update: {
          created_at?: string
          details?: Json | null
          id?: string
          level?: string
          message?: string | null
          phase?: string | null
        }
        Relationships: []
      }
      reconciliation_issues: {
        Row: {
          action_cta: string | null
          age_days: number | null
          assigned_at: string | null
          assignee_canonical_contact_id: number | null
          canonical_entity_id: string | null
          canonical_entity_type: string | null
          canonical_id: string | null
          company_id: number | null
          description: string
          detected_at: string
          impact_mxn: number | null
          invariant_key: string | null
          issue_id: string
          issue_type: string
          metadata: Json
          odoo_company_id: number | null
          odoo_invoice_id: number | null
          odoo_payment_id: number | null
          priority_score: number | null
          resolution: string | null
          resolution_note: string | null
          resolved_at: string | null
          severity: string
          uuid_sat: string | null
        }
        Insert: {
          action_cta?: string | null
          age_days?: number | null
          assigned_at?: string | null
          assignee_canonical_contact_id?: number | null
          canonical_entity_id?: string | null
          canonical_entity_type?: string | null
          canonical_id?: string | null
          company_id?: number | null
          description: string
          detected_at?: string
          impact_mxn?: number | null
          invariant_key?: string | null
          issue_id?: string
          issue_type: string
          metadata?: Json
          odoo_company_id?: number | null
          odoo_invoice_id?: number | null
          odoo_payment_id?: number | null
          priority_score?: number | null
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          severity: string
          uuid_sat?: string | null
        }
        Update: {
          action_cta?: string | null
          age_days?: number | null
          assigned_at?: string | null
          assignee_canonical_contact_id?: number | null
          canonical_entity_id?: string | null
          canonical_entity_type?: string | null
          canonical_id?: string | null
          company_id?: number | null
          description?: string
          detected_at?: string
          impact_mxn?: number | null
          invariant_key?: string | null
          issue_id?: string
          issue_type?: string
          metadata?: Json
          odoo_company_id?: number | null
          odoo_invoice_id?: number | null
          odoo_payment_id?: number | null
          priority_score?: number | null
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          severity?: string
          uuid_sat?: string | null
        }
        Relationships: []
      }
      schema_changes: {
        Row: {
          change_type: string
          created_at: string | null
          description: string
          error_message: string | null
          id: number
          sql_executed: string
          success: boolean | null
          table_name: string | null
          triggered_by: string | null
        }
        Insert: {
          change_type: string
          created_at?: string | null
          description: string
          error_message?: string | null
          id?: number
          sql_executed: string
          success?: boolean | null
          table_name?: string | null
          triggered_by?: string | null
        }
        Update: {
          change_type?: string
          created_at?: string | null
          description?: string
          error_message?: string | null
          id?: number
          sql_executed?: string
          success?: boolean | null
          table_name?: string | null
          triggered_by?: string | null
        }
        Relationships: []
      }
      source_links: {
        Row: {
          canonical_entity_id: string
          canonical_entity_type: string
          id: number
          match_confidence: number
          match_method: string
          matched_at: string
          matched_by: string | null
          notes: string | null
          source: string
          source_id: string
          source_natural_key: string | null
          source_table: string
          superseded_at: string | null
        }
        Insert: {
          canonical_entity_id: string
          canonical_entity_type: string
          id?: number
          match_confidence: number
          match_method: string
          matched_at?: string
          matched_by?: string | null
          notes?: string | null
          source: string
          source_id: string
          source_natural_key?: string | null
          source_table: string
          superseded_at?: string | null
        }
        Update: {
          canonical_entity_id?: string
          canonical_entity_type?: string
          id?: number
          match_confidence?: number
          match_method?: string
          matched_at?: string
          matched_by?: string | null
          notes?: string | null
          source?: string
          source_id?: string
          source_natural_key?: string | null
          source_table?: string
          superseded_at?: string | null
        }
        Relationships: []
      }
      sync_commands: {
        Row: {
          command: string
          completed_at: string | null
          created_at: string
          id: number
          requested_by: string | null
          result: Json | null
          started_at: string | null
          status: string
        }
        Insert: {
          command: string
          completed_at?: string | null
          created_at?: string
          id?: number
          requested_by?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
        }
        Update: {
          command?: string
          completed_at?: string | null
          created_at?: string
          id?: number
          requested_by?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      sync_state: {
        Row: {
          account: string
          emails_synced: number | null
          last_history_id: string | null
          last_sync_at: string | null
          updated_at: string
        }
        Insert: {
          account: string
          emails_synced?: number | null
          last_history_id?: string | null
          last_sync_at?: string | null
          updated_at?: string
        }
        Update: {
          account?: string
          emails_synced?: number | null
          last_history_id?: string | null
          last_sync_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      syntage_electronic_accounting: {
        Row: {
          created_at: string
          ejercicio: number
          hash: string | null
          odoo_company_id: number | null
          periodo: string
          raw_payload: Json | null
          record_type: string
          source_id: number | null
          source_ref: string | null
          synced_at: string
          syntage_id: string
          taxpayer_rfc: string
          tipo_envio: string | null
          xml_file_id: number | null
        }
        Insert: {
          created_at?: string
          ejercicio: number
          hash?: string | null
          odoo_company_id?: number | null
          periodo: string
          raw_payload?: Json | null
          record_type: string
          source_id?: number | null
          source_ref?: string | null
          synced_at?: string
          syntage_id: string
          taxpayer_rfc: string
          tipo_envio?: string | null
          xml_file_id?: number | null
        }
        Update: {
          created_at?: string
          ejercicio?: number
          hash?: string | null
          odoo_company_id?: number | null
          periodo?: string
          raw_payload?: Json | null
          record_type?: string
          source_id?: number | null
          source_ref?: string | null
          synced_at?: string
          syntage_id?: string
          taxpayer_rfc?: string
          tipo_envio?: string | null
          xml_file_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "syntage_electronic_accounting_xml_file_id_fkey"
            columns: ["xml_file_id"]
            isOneToOne: false
            referencedRelation: "syntage_files"
            referencedColumns: ["id"]
          },
        ]
      }
      syntage_entity_map: {
        Row: {
          alias: string
          backfill_from: string | null
          created_at: string
          is_active: boolean
          odoo_company_id: number
          priority: string
          taxpayer_rfc: string
          updated_at: string
        }
        Insert: {
          alias: string
          backfill_from?: string | null
          created_at?: string
          is_active?: boolean
          odoo_company_id: number
          priority?: string
          taxpayer_rfc: string
          updated_at?: string
        }
        Update: {
          alias?: string
          backfill_from?: string | null
          created_at?: string
          is_active?: boolean
          odoo_company_id?: number
          priority?: string
          taxpayer_rfc?: string
          updated_at?: string
        }
        Relationships: []
      }
      syntage_extractions: {
        Row: {
          created_at: string
          error: string | null
          extractor_type: string
          finished_at: string | null
          odoo_company_id: number | null
          options: Json | null
          raw_payload: Json | null
          rows_produced: number | null
          started_at: string | null
          status: string
          syntage_id: string
          taxpayer_rfc: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          extractor_type: string
          finished_at?: string | null
          odoo_company_id?: number | null
          options?: Json | null
          raw_payload?: Json | null
          rows_produced?: number | null
          started_at?: string | null
          status: string
          syntage_id: string
          taxpayer_rfc: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          extractor_type?: string
          finished_at?: string | null
          odoo_company_id?: number | null
          options?: Json | null
          raw_payload?: Json | null
          rows_produced?: number | null
          started_at?: string | null
          status?: string
          syntage_id?: string
          taxpayer_rfc?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "syntage_extractions_taxpayer_rfc_fkey"
            columns: ["taxpayer_rfc"]
            isOneToOne: false
            referencedRelation: "syntage_taxpayers"
            referencedColumns: ["rfc"]
          },
        ]
      }
      syntage_files: {
        Row: {
          created_at: string
          download_url_cached_until: string | null
          file_type: string
          filename: string | null
          id: number
          mime_type: string | null
          odoo_company_id: number | null
          raw_payload: Json | null
          size_bytes: number | null
          storage_path: string | null
          syntage_id: string
          taxpayer_rfc: string
        }
        Insert: {
          created_at?: string
          download_url_cached_until?: string | null
          file_type: string
          filename?: string | null
          id?: number
          mime_type?: string | null
          odoo_company_id?: number | null
          raw_payload?: Json | null
          size_bytes?: number | null
          storage_path?: string | null
          syntage_id: string
          taxpayer_rfc: string
        }
        Update: {
          created_at?: string
          download_url_cached_until?: string | null
          file_type?: string
          filename?: string | null
          id?: number
          mime_type?: string | null
          odoo_company_id?: number | null
          raw_payload?: Json | null
          size_bytes?: number | null
          storage_path?: string | null
          syntage_id?: string
          taxpayer_rfc?: string
        }
        Relationships: []
      }
      syntage_invoice_line_items: {
        Row: {
          cantidad: number | null
          clave_prod_serv: string | null
          clave_unidad: string | null
          created_at: string
          descripcion: string | null
          descuento: number | null
          importe: number | null
          invoice_uuid: string
          line_number: number | null
          odoo_company_id: number | null
          raw_payload: Json | null
          source_id: number | null
          source_ref: string | null
          synced_at: string
          syntage_id: string
          taxpayer_rfc: string
          unidad: string | null
          valor_unitario: number | null
        }
        Insert: {
          cantidad?: number | null
          clave_prod_serv?: string | null
          clave_unidad?: string | null
          created_at?: string
          descripcion?: string | null
          descuento?: number | null
          importe?: number | null
          invoice_uuid: string
          line_number?: number | null
          odoo_company_id?: number | null
          raw_payload?: Json | null
          source_id?: number | null
          source_ref?: string | null
          synced_at?: string
          syntage_id: string
          taxpayer_rfc: string
          unidad?: string | null
          valor_unitario?: number | null
        }
        Update: {
          cantidad?: number | null
          clave_prod_serv?: string | null
          clave_unidad?: string | null
          created_at?: string
          descripcion?: string | null
          descuento?: number | null
          importe?: number | null
          invoice_uuid?: string
          line_number?: number | null
          odoo_company_id?: number | null
          raw_payload?: Json | null
          source_id?: number | null
          source_ref?: string | null
          synced_at?: string
          syntage_id?: string
          taxpayer_rfc?: string
          unidad?: string | null
          valor_unitario?: number | null
        }
        Relationships: []
      }
      syntage_invoice_payments: {
        Row: {
          batch_payment_id: string | null
          created_at: string
          direction: string
          doctos_relacionados: Json | null
          estado_sat: string | null
          fecha_pago: string | null
          forma_pago_p: string | null
          moneda_p: string | null
          monto: number | null
          num_operacion: string | null
          odoo_company_id: number | null
          raw_payload: Json | null
          rfc_emisor_cta_ben: string | null
          rfc_emisor_cta_ord: string | null
          source_id: number | null
          source_ref: string | null
          synced_at: string
          syntage_id: string
          taxpayer_rfc: string
          tipo_cambio_p: number | null
          uuid_complemento: string
          xml_file_id: number | null
        }
        Insert: {
          batch_payment_id?: string | null
          created_at?: string
          direction: string
          doctos_relacionados?: Json | null
          estado_sat?: string | null
          fecha_pago?: string | null
          forma_pago_p?: string | null
          moneda_p?: string | null
          monto?: number | null
          num_operacion?: string | null
          odoo_company_id?: number | null
          raw_payload?: Json | null
          rfc_emisor_cta_ben?: string | null
          rfc_emisor_cta_ord?: string | null
          source_id?: number | null
          source_ref?: string | null
          synced_at?: string
          syntage_id: string
          taxpayer_rfc: string
          tipo_cambio_p?: number | null
          uuid_complemento: string
          xml_file_id?: number | null
        }
        Update: {
          batch_payment_id?: string | null
          created_at?: string
          direction?: string
          doctos_relacionados?: Json | null
          estado_sat?: string | null
          fecha_pago?: string | null
          forma_pago_p?: string | null
          moneda_p?: string | null
          monto?: number | null
          num_operacion?: string | null
          odoo_company_id?: number | null
          raw_payload?: Json | null
          rfc_emisor_cta_ben?: string | null
          rfc_emisor_cta_ord?: string | null
          source_id?: number | null
          source_ref?: string | null
          synced_at?: string
          syntage_id?: string
          taxpayer_rfc?: string
          tipo_cambio_p?: number | null
          uuid_complemento?: string
          xml_file_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "syntage_invoice_payments_xml_file_id_fkey"
            columns: ["xml_file_id"]
            isOneToOne: false
            referencedRelation: "syntage_files"
            referencedColumns: ["id"]
          },
        ]
      }
      syntage_invoices: {
        Row: {
          company_id: number | null
          created_at: string
          descuento: number | null
          direction: string
          emisor_blacklist_status: string | null
          emisor_nombre: string | null
          emisor_rfc: string | null
          estado_sat: string | null
          fecha_cancelacion: string | null
          fecha_emision: string | null
          fecha_timbrado: string | null
          folio: string | null
          forma_pago: string | null
          impuestos_retenidos: number | null
          impuestos_trasladados: number | null
          metodo_pago: string | null
          moneda: string | null
          odoo_company_id: number | null
          pdf_file_id: number | null
          raw_payload: Json | null
          receptor_blacklist_status: string | null
          receptor_nombre: string | null
          receptor_rfc: string | null
          serie: string | null
          source_id: number | null
          source_ref: string | null
          subtotal: number | null
          synced_at: string
          syntage_id: string
          taxpayer_rfc: string
          tipo_cambio: number | null
          tipo_comprobante: string | null
          total: number | null
          total_mxn: number | null
          uso_cfdi: string | null
          uuid: string
          xml_file_id: number | null
        }
        Insert: {
          company_id?: number | null
          created_at?: string
          descuento?: number | null
          direction: string
          emisor_blacklist_status?: string | null
          emisor_nombre?: string | null
          emisor_rfc?: string | null
          estado_sat?: string | null
          fecha_cancelacion?: string | null
          fecha_emision?: string | null
          fecha_timbrado?: string | null
          folio?: string | null
          forma_pago?: string | null
          impuestos_retenidos?: number | null
          impuestos_trasladados?: number | null
          metodo_pago?: string | null
          moneda?: string | null
          odoo_company_id?: number | null
          pdf_file_id?: number | null
          raw_payload?: Json | null
          receptor_blacklist_status?: string | null
          receptor_nombre?: string | null
          receptor_rfc?: string | null
          serie?: string | null
          source_id?: number | null
          source_ref?: string | null
          subtotal?: number | null
          synced_at?: string
          syntage_id: string
          taxpayer_rfc: string
          tipo_cambio?: number | null
          tipo_comprobante?: string | null
          total?: number | null
          total_mxn?: number | null
          uso_cfdi?: string | null
          uuid: string
          xml_file_id?: number | null
        }
        Update: {
          company_id?: number | null
          created_at?: string
          descuento?: number | null
          direction?: string
          emisor_blacklist_status?: string | null
          emisor_nombre?: string | null
          emisor_rfc?: string | null
          estado_sat?: string | null
          fecha_cancelacion?: string | null
          fecha_emision?: string | null
          fecha_timbrado?: string | null
          folio?: string | null
          forma_pago?: string | null
          impuestos_retenidos?: number | null
          impuestos_trasladados?: number | null
          metodo_pago?: string | null
          moneda?: string | null
          odoo_company_id?: number | null
          pdf_file_id?: number | null
          raw_payload?: Json | null
          receptor_blacklist_status?: string | null
          receptor_nombre?: string | null
          receptor_rfc?: string | null
          serie?: string | null
          source_id?: number | null
          source_ref?: string | null
          subtotal?: number | null
          synced_at?: string
          syntage_id?: string
          taxpayer_rfc?: string
          tipo_cambio?: number | null
          tipo_comprobante?: string | null
          total?: number | null
          total_mxn?: number | null
          uso_cfdi?: string | null
          uuid?: string
          xml_file_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "syntage_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syntage_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "syntage_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "syntage_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
          {
            foreignKeyName: "syntage_invoices_pdf_file_id_fkey"
            columns: ["pdf_file_id"]
            isOneToOne: false
            referencedRelation: "syntage_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syntage_invoices_xml_file_id_fkey"
            columns: ["xml_file_id"]
            isOneToOne: false
            referencedRelation: "syntage_files"
            referencedColumns: ["id"]
          },
        ]
      }
      syntage_tax_retentions: {
        Row: {
          created_at: string
          direction: string
          emisor_nombre: string | null
          emisor_rfc: string | null
          estado_sat: string | null
          fecha_emision: string | null
          impuestos_retenidos: Json | null
          monto_total_gravado: number | null
          monto_total_operacion: number | null
          monto_total_retenido: number | null
          odoo_company_id: number | null
          raw_payload: Json | null
          receptor_nombre: string | null
          receptor_rfc: string | null
          source_id: number | null
          source_ref: string | null
          synced_at: string
          syntage_id: string
          taxpayer_rfc: string
          tipo_retencion: string | null
          uuid: string
          xml_file_id: number | null
        }
        Insert: {
          created_at?: string
          direction: string
          emisor_nombre?: string | null
          emisor_rfc?: string | null
          estado_sat?: string | null
          fecha_emision?: string | null
          impuestos_retenidos?: Json | null
          monto_total_gravado?: number | null
          monto_total_operacion?: number | null
          monto_total_retenido?: number | null
          odoo_company_id?: number | null
          raw_payload?: Json | null
          receptor_nombre?: string | null
          receptor_rfc?: string | null
          source_id?: number | null
          source_ref?: string | null
          synced_at?: string
          syntage_id: string
          taxpayer_rfc: string
          tipo_retencion?: string | null
          uuid: string
          xml_file_id?: number | null
        }
        Update: {
          created_at?: string
          direction?: string
          emisor_nombre?: string | null
          emisor_rfc?: string | null
          estado_sat?: string | null
          fecha_emision?: string | null
          impuestos_retenidos?: Json | null
          monto_total_gravado?: number | null
          monto_total_operacion?: number | null
          monto_total_retenido?: number | null
          odoo_company_id?: number | null
          raw_payload?: Json | null
          receptor_nombre?: string | null
          receptor_rfc?: string | null
          source_id?: number | null
          source_ref?: string | null
          synced_at?: string
          syntage_id?: string
          taxpayer_rfc?: string
          tipo_retencion?: string | null
          uuid?: string
          xml_file_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "syntage_tax_retentions_xml_file_id_fkey"
            columns: ["xml_file_id"]
            isOneToOne: false
            referencedRelation: "syntage_files"
            referencedColumns: ["id"]
          },
        ]
      }
      syntage_tax_returns: {
        Row: {
          created_at: string
          ejercicio: number
          fecha_presentacion: string | null
          impuesto: string | null
          monto_pagado: number | null
          numero_operacion: string | null
          odoo_company_id: number | null
          pdf_file_id: number | null
          periodo: string
          raw_payload: Json | null
          return_type: string
          source_id: number | null
          source_ref: string | null
          synced_at: string
          syntage_id: string
          taxpayer_rfc: string
          tipo_declaracion: string | null
        }
        Insert: {
          created_at?: string
          ejercicio: number
          fecha_presentacion?: string | null
          impuesto?: string | null
          monto_pagado?: number | null
          numero_operacion?: string | null
          odoo_company_id?: number | null
          pdf_file_id?: number | null
          periodo: string
          raw_payload?: Json | null
          return_type: string
          source_id?: number | null
          source_ref?: string | null
          synced_at?: string
          syntage_id: string
          taxpayer_rfc: string
          tipo_declaracion?: string | null
        }
        Update: {
          created_at?: string
          ejercicio?: number
          fecha_presentacion?: string | null
          impuesto?: string | null
          monto_pagado?: number | null
          numero_operacion?: string | null
          odoo_company_id?: number | null
          pdf_file_id?: number | null
          periodo?: string
          raw_payload?: Json | null
          return_type?: string
          source_id?: number | null
          source_ref?: string | null
          synced_at?: string
          syntage_id?: string
          taxpayer_rfc?: string
          tipo_declaracion?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "syntage_tax_returns_pdf_file_id_fkey"
            columns: ["pdf_file_id"]
            isOneToOne: false
            referencedRelation: "syntage_files"
            referencedColumns: ["id"]
          },
        ]
      }
      syntage_tax_status: {
        Row: {
          actividades_economicas: Json | null
          created_at: string
          domicilio_fiscal: Json | null
          fecha_consulta: string | null
          odoo_company_id: number | null
          opinion_cumplimiento: string | null
          pdf_file_id: number | null
          raw_payload: Json | null
          regimen_fiscal: string | null
          source_id: number | null
          source_ref: string | null
          synced_at: string
          syntage_id: string
          target_rfc: string
          taxpayer_rfc: string
        }
        Insert: {
          actividades_economicas?: Json | null
          created_at?: string
          domicilio_fiscal?: Json | null
          fecha_consulta?: string | null
          odoo_company_id?: number | null
          opinion_cumplimiento?: string | null
          pdf_file_id?: number | null
          raw_payload?: Json | null
          regimen_fiscal?: string | null
          source_id?: number | null
          source_ref?: string | null
          synced_at?: string
          syntage_id: string
          target_rfc: string
          taxpayer_rfc: string
        }
        Update: {
          actividades_economicas?: Json | null
          created_at?: string
          domicilio_fiscal?: Json | null
          fecha_consulta?: string | null
          odoo_company_id?: number | null
          opinion_cumplimiento?: string | null
          pdf_file_id?: number | null
          raw_payload?: Json | null
          regimen_fiscal?: string | null
          source_id?: number | null
          source_ref?: string | null
          synced_at?: string
          syntage_id?: string
          target_rfc?: string
          taxpayer_rfc?: string
        }
        Relationships: [
          {
            foreignKeyName: "syntage_tax_status_pdf_file_id_fkey"
            columns: ["pdf_file_id"]
            isOneToOne: false
            referencedRelation: "syntage_files"
            referencedColumns: ["id"]
          },
        ]
      }
      syntage_taxpayers: {
        Row: {
          created_at: string
          name: string | null
          person_type: string | null
          raw_payload: Json | null
          registration_date: string | null
          rfc: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          name?: string | null
          person_type?: string | null
          raw_payload?: Json | null
          registration_date?: string | null
          rfc: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          name?: string | null
          person_type?: string | null
          raw_payload?: Json | null
          registration_date?: string | null
          rfc?: string
          updated_at?: string
        }
        Relationships: []
      }
      syntage_webhook_events: {
        Row: {
          event_id: string
          event_type: string
          received_at: string
          source: string
        }
        Insert: {
          event_id: string
          event_type: string
          received_at?: string
          source?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          received_at?: string
          source?: string
        }
        Relationships: []
      }
      threads: {
        Row: {
          account: string
          company_id: number | null
          created_at: string
          gmail_thread_id: string
          has_external_reply: boolean | null
          has_internal_reply: boolean | null
          hours_without_response: number | null
          id: number
          last_activity: string | null
          last_sender: string | null
          last_sender_type: string | null
          message_count: number | null
          participant_emails: string[] | null
          started_at: string | null
          started_by: string | null
          started_by_contact_id: number | null
          started_by_type: string | null
          status: string | null
          subject: string | null
          subject_normalized: string | null
          updated_at: string
        }
        Insert: {
          account: string
          company_id?: number | null
          created_at?: string
          gmail_thread_id: string
          has_external_reply?: boolean | null
          has_internal_reply?: boolean | null
          hours_without_response?: number | null
          id?: never
          last_activity?: string | null
          last_sender?: string | null
          last_sender_type?: string | null
          message_count?: number | null
          participant_emails?: string[] | null
          started_at?: string | null
          started_by?: string | null
          started_by_contact_id?: number | null
          started_by_type?: string | null
          status?: string | null
          subject?: string | null
          subject_normalized?: string | null
          updated_at?: string
        }
        Update: {
          account?: string
          company_id?: number | null
          created_at?: string
          gmail_thread_id?: string
          has_external_reply?: boolean | null
          has_internal_reply?: boolean | null
          hours_without_response?: number | null
          id?: never
          last_activity?: string | null
          last_sender?: string | null
          last_sender_type?: string | null
          message_count?: number | null
          participant_emails?: string[] | null
          started_at?: string | null
          started_by?: string | null
          started_by_contact_id?: number | null
          started_by_type?: string | null
          status?: string | null
          subject?: string | null
          subject_normalized?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "threads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "threads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "threads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "threads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
          {
            foreignKeyName: "threads_started_by_contact_id_fkey"
            columns: ["started_by_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      token_usage: {
        Row: {
          created_at: string
          endpoint: string
          id: number
          input_tokens: number
          model: string | null
          output_tokens: number
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: number
          input_tokens?: number
          model?: string | null
          output_tokens?: number
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: number
          input_tokens?: number
          model?: string | null
          output_tokens?: number
        }
        Relationships: []
      }
    }
    Views: {
      accounting_anomalies: {
        Row: {
          amount: number | null
          anomaly_type: string | null
          company_id: number | null
          company_name: string | null
          description: string | null
          detected_date: string | null
          severity: string | null
        }
        Relationships: []
      }
      agent_effectiveness: {
        Row: {
          acted_rate_pct: number | null
          agent_id: number | null
          avg_confidence: number | null
          avg_duration_s: number | null
          avg_impact_mxn: number | null
          dismiss_rate_pct: number | null
          domain: string | null
          expire_rate_pct: number | null
          impact_delivered_mxn: number | null
          impact_expired_mxn: number | null
          insights_24h: number | null
          insights_7d: number | null
          is_active: boolean | null
          last_run_at: string | null
          name: string | null
          runs_24h: number | null
          slug: string | null
          state_acted: number | null
          state_archived: number | null
          state_dismissed: number | null
          state_expired: number | null
          state_new: number | null
          state_seen: number | null
          total_insights: number | null
        }
        Relationships: []
      }
      ar_aging_detail: {
        Row: {
          aging_bucket: string | null
          amount_residual: number | null
          amount_total: number | null
          bucket_sort: number | null
          company_id: number | null
          company_name: string | null
          currency: string | null
          days_overdue: number | null
          due_date: string | null
          invoice_date: string | null
          invoice_id: number | null
          invoice_name: string | null
          payment_state: string | null
        }
        Relationships: [
          {
            foreignKeyName: "odoo_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odoo_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
        ]
      }
      bom_duplicate_components: {
        Row: {
          computed_at: string | null
          intra_dupe_components: number | null
          intra_dupe_overcounted_mxn: number | null
          odoo_product_id: number | null
          product_name: string | null
          product_ref: string | null
          same_name_groups: number | null
          same_name_overcounted_mxn: number | null
          total_overcounted_per_unit_mxn: number | null
        }
        Relationships: []
      }
      bom_duplicate_components_detail: {
        Row: {
          component_id: number | null
          component_name: string | null
          component_ref: string | null
          component_uom: string | null
          dupe_kind: string | null
          group_size: number | null
          qty: number | null
          root_product_id: number | null
          unit_cost: number | null
        }
        Relationships: []
      }
      canonical_account_balances: {
        Row: {
          account_code: string | null
          account_name: string | null
          account_type: string | null
          balance: number | null
          balance_sheet_bucket: string | null
          canonical_id: number | null
          credit: number | null
          debit: number | null
          deprecated: boolean | null
          odoo_account_id: number | null
          period: string | null
          refreshed_at: string | null
          synced_at: string | null
        }
        Relationships: []
      }
      canonical_bank_balances: {
        Row: {
          bank_account: string | null
          canonical_id: number | null
          classification: string | null
          company_name: string | null
          currency: string | null
          current_balance: number | null
          current_balance_mxn: number | null
          is_stale: boolean | null
          journal_type: string | null
          name: string | null
          odoo_company_id: number | null
          odoo_journal_id: number | null
          refreshed_at: string | null
          updated_at: string | null
        }
        Insert: {
          bank_account?: string | null
          canonical_id?: number | null
          classification?: never
          company_name?: string | null
          currency?: string | null
          current_balance?: number | null
          current_balance_mxn?: number | null
          is_stale?: never
          journal_type?: string | null
          name?: string | null
          odoo_company_id?: number | null
          odoo_journal_id?: number | null
          refreshed_at?: never
          updated_at?: string | null
        }
        Update: {
          bank_account?: string | null
          canonical_id?: number | null
          classification?: never
          company_name?: string | null
          currency?: string | null
          current_balance?: number | null
          current_balance_mxn?: number | null
          is_stale?: never
          journal_type?: string | null
          name?: string | null
          odoo_company_id?: number | null
          odoo_journal_id?: number | null
          refreshed_at?: never
          updated_at?: string | null
        }
        Relationships: []
      }
      canonical_chart_of_accounts: {
        Row: {
          account_type: string | null
          active: boolean | null
          canonical_id: number | null
          code: string | null
          deprecated: boolean | null
          level_1_code: string | null
          name: string | null
          odoo_account_id: number | null
          odoo_company_id: number | null
          reconcile: boolean | null
          synced_at: string | null
          tree_level: number | null
        }
        Insert: {
          account_type?: string | null
          active?: boolean | null
          canonical_id?: number | null
          code?: string | null
          deprecated?: boolean | null
          level_1_code?: never
          name?: string | null
          odoo_account_id?: number | null
          odoo_company_id?: number | null
          reconcile?: boolean | null
          synced_at?: string | null
          tree_level?: never
        }
        Update: {
          account_type?: string | null
          active?: boolean | null
          canonical_id?: number | null
          code?: string | null
          deprecated?: boolean | null
          level_1_code?: never
          name?: string | null
          odoo_account_id?: number | null
          odoo_company_id?: number | null
          reconcile?: boolean | null
          synced_at?: string | null
          tree_level?: never
        }
        Relationships: []
      }
      canonical_crm_leads: {
        Row: {
          active: boolean | null
          assigned_user: string | null
          assignee_canonical_contact_id: number | null
          canonical_company_id: number | null
          canonical_id: number | null
          create_date: string | null
          date_deadline: string | null
          days_open: number | null
          expected_revenue: number | null
          lead_type: string | null
          name: string | null
          odoo_lead_id: number | null
          odoo_partner_id: number | null
          probability: number | null
          stage: string | null
          synced_at: string | null
        }
        Relationships: []
      }
      canonical_deliveries: {
        Row: {
          canonical_company_id: number | null
          canonical_id: number | null
          create_date: string | null
          date_done: string | null
          is_late: boolean | null
          lead_time_days: number | null
          name: string | null
          odoo_company_id: number | null
          odoo_partner_id: number | null
          odoo_picking_id: number | null
          origin: string | null
          picking_type: string | null
          picking_type_code: string | null
          refreshed_at: string | null
          scheduled_date: string | null
          state: string | null
        }
        Relationships: []
      }
      canonical_employees: {
        Row: {
          canonical_name: string | null
          coach_name: string | null
          contact_id: number | null
          created_at: string | null
          department_id: number | null
          department_name: string | null
          display_name: string | null
          is_active: boolean | null
          job_name: string | null
          job_title: string | null
          manager_canonical_contact_id: number | null
          odoo_employee_id: number | null
          odoo_user_id: number | null
          open_insights_count: number | null
          overdue_activities_count: number | null
          pending_activities_count: number | null
          primary_email: string | null
          updated_at: string | null
          work_phone: string | null
        }
        Relationships: [
          {
            foreignKeyName: "canonical_contacts_manager_canonical_contact_id_fkey"
            columns: ["manager_canonical_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canonical_contacts_manager_canonical_contact_id_fkey"
            columns: ["manager_canonical_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_crm_leads"
            referencedColumns: ["assignee_canonical_contact_id"]
          },
          {
            foreignKeyName: "canonical_contacts_manager_canonical_contact_id_fkey"
            columns: ["manager_canonical_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_employees"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "canonical_contacts_manager_canonical_contact_id_fkey"
            columns: ["manager_canonical_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_purchase_orders"
            referencedColumns: ["buyer_canonical_contact_id"]
          },
          {
            foreignKeyName: "canonical_contacts_manager_canonical_contact_id_fkey"
            columns: ["manager_canonical_contact_id"]
            isOneToOne: false
            referencedRelation: "canonical_sale_orders"
            referencedColumns: ["salesperson_canonical_contact_id"]
          },
        ]
      }
      canonical_fx_rates: {
        Row: {
          canonical_id: number | null
          currency: string | null
          inverse_rate: number | null
          is_stale: boolean | null
          odoo_company_id: number | null
          rate: number | null
          rate_date: string | null
          recency_rank: number | null
          synced_at: string | null
        }
        Relationships: []
      }
      canonical_inventory: {
        Row: {
          available_qty: number | null
          canonical_product_id: number | null
          display_name: string | null
          internal_ref: string | null
          is_stockout: boolean | null
          location_name: string | null
          odoo_orderpoint_id: number | null
          odoo_product_id: number | null
          orderpoint_max: number | null
          orderpoint_min: number | null
          orderpoint_qty_on_hand: number | null
          orderpoint_untuned: boolean | null
          qty_forecast: number | null
          qty_to_order: number | null
          refreshed_at: string | null
          reorder_max: number | null
          reorder_min: number | null
          reserved_qty: number | null
          stock_qty: number | null
          trigger_type: string | null
          warehouse_name: string | null
        }
        Relationships: []
      }
      canonical_manufacturing: {
        Row: {
          assigned_user: string | null
          canonical_id: number | null
          canonical_product_id: number | null
          create_date: string | null
          cycle_time_days: number | null
          date_finished: string | null
          date_start: string | null
          name: string | null
          odoo_company_id: number | null
          odoo_product_id: number | null
          odoo_production_id: number | null
          origin: string | null
          product_name: string | null
          qty_planned: number | null
          qty_produced: number | null
          refreshed_at: string | null
          state: string | null
          yield_pct: number | null
        }
        Relationships: []
      }
      canonical_order_lines: {
        Row: {
          canonical_company_id: number | null
          canonical_id: number | null
          canonical_product_id: number | null
          currency: string | null
          discount: number | null
          has_pending_delivery: boolean | null
          has_pending_invoicing: boolean | null
          line_uom: string | null
          line_uom_id: number | null
          odoo_company_id: number | null
          odoo_line_id: number | null
          odoo_order_id: number | null
          odoo_partner_id: number | null
          odoo_product_id: number | null
          order_date: string | null
          order_name: string | null
          order_state: string | null
          order_type: string | null
          price_unit: number | null
          product_name: string | null
          product_ref: string | null
          qty: number | null
          qty_delivered: number | null
          qty_invoiced: number | null
          qty_pending_invoice: number | null
          refreshed_at: string | null
          salesperson_name: string | null
          subtotal: number | null
          subtotal_mxn: number | null
        }
        Relationships: []
      }
      canonical_purchase_orders: {
        Row: {
          amount_total: number | null
          amount_total_mxn: number | null
          amount_untaxed: number | null
          amount_untaxed_mxn: number | null
          buyer_canonical_contact_id: number | null
          buyer_email: string | null
          buyer_name: string | null
          buyer_user_id: number | null
          canonical_company_id: number | null
          canonical_id: number | null
          create_date: string | null
          currency: string | null
          date_approve: string | null
          date_order: string | null
          name: string | null
          odoo_company_id: number | null
          odoo_order_id: number | null
          odoo_partner_id: number | null
          refreshed_at: string | null
          state: string | null
        }
        Relationships: []
      }
      canonical_sale_orders: {
        Row: {
          amount_total: number | null
          amount_total_mxn: number | null
          amount_untaxed: number | null
          amount_untaxed_mxn: number | null
          canonical_company_id: number | null
          canonical_id: number | null
          commitment_date: string | null
          create_date: string | null
          currency: string | null
          date_order: string | null
          is_commitment_overdue: boolean | null
          margin: number | null
          margin_percent: number | null
          name: string | null
          odoo_company_id: number | null
          odoo_order_id: number | null
          odoo_partner_id: number | null
          refreshed_at: string | null
          salesperson_canonical_contact_id: number | null
          salesperson_email: string | null
          salesperson_name: string | null
          salesperson_user_id: number | null
          state: string | null
          team_name: string | null
        }
        Relationships: []
      }
      cash_flow_aging: {
        Row: {
          company_id: number | null
          company_name: string | null
          current_amount: number | null
          overdue_1_30: number | null
          overdue_120plus: number | null
          overdue_31_60: number | null
          overdue_61_90: number | null
          overdue_90plus: number | null
          overdue_91_120: number | null
          tier: string | null
          total_receivable: number | null
          total_revenue: number | null
        }
        Relationships: [
          {
            foreignKeyName: "odoo_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odoo_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
        ]
      }
      cashflow_in_transit: {
        Row: {
          account_count: number | null
          accounts_with_data: number | null
          in_transit_mxn: number | null
        }
        Relationships: []
      }
      cashflow_projection: {
        Row: {
          amount_residual: number | null
          collection_probability: number | null
          company_id: number | null
          days_overdue: number | null
          expected_amount: number | null
          flow_type: string | null
          invoice_name: string | null
          projected_date: string | null
        }
        Relationships: []
      }
      cashflow_unreconciled: {
        Row: {
          n_pending_inbound: number | null
          n_pending_outbound: number | null
          n_unmatched_inbound: number | null
          n_unmatched_outbound: number | null
          pending_inbound_mxn: number | null
          pending_outbound_mxn: number | null
          unmatched_inbound_mxn: number | null
          unmatched_outbound_mxn: number | null
        }
        Relationships: []
      }
      cfo_dashboard: {
        Row: {
          cartera_vencida: number | null
          clientes_morosos: number | null
          cobros_30d: number | null
          cuentas_por_cobrar: number | null
          cuentas_por_pagar: number | null
          deuda_tarjetas: number | null
          efectivo_mxn: number | null
          efectivo_total_mxn: number | null
          efectivo_usd: number | null
          pagos_prov_30d: number | null
          posicion_neta: number | null
          ventas_30d: number | null
        }
        Relationships: []
      }
      claude_cost_summary: {
        Row: {
          calls: number | null
          calls_24h: number | null
          cost_24h: number | null
          cost_30d: number | null
          cost_7d: number | null
          endpoint: string | null
          last_call: string | null
          model: string | null
          total_cost_usd: number | null
          total_input_tokens: number | null
          total_output_tokens: number | null
        }
        Relationships: []
      }
      client_reorder_predictions: {
        Row: {
          avg_cycle_days: number | null
          avg_order_value: number | null
          company_id: number | null
          company_name: string | null
          days_overdue_reorder: number | null
          days_since_last: number | null
          last_order_date: string | null
          order_count: number | null
          predicted_next_order: string | null
          reorder_status: string | null
          salesperson_name: string | null
          stddev_days: number | null
          tier: string | null
          top_product_ref: string | null
          total_revenue: number | null
        }
        Relationships: []
      }
      collection_effectiveness_index: {
        Row: {
          avg_days_to_pay: number | null
          billed_mxn: number | null
          cei_delta_vs_prev: number | null
          cei_pct: number | null
          cohort_age_months: number | null
          cohort_month: string | null
          collected_mxn: number | null
          customers: number | null
          health_status: string | null
          invoices_issued: number | null
          leakage_90d_pct: number | null
          outstanding_mxn: number | null
          overdue_30d_mxn: number | null
          overdue_90d_mxn: number | null
        }
        Relationships: []
      }
      company_69b_status: {
        Row: {
          blacklist_level: string | null
          canonical_name: string | null
          company_id: number | null
          first_flagged_at: string | null
          flagged_as_emisor: boolean | null
          flagged_as_receptor: boolean | null
          invoices_as_emisor_flagged: number | null
          invoices_as_receptor_flagged: number | null
          last_flagged_at: string | null
          name: string | null
          rfc: string | null
          total_definitive_invoices: number | null
          total_presumed_invoices: number | null
        }
        Relationships: []
      }
      customer_product_matrix: {
        Row: {
          company_id: number | null
          company_name: string | null
          odoo_product_id: number | null
          orders: number | null
          pct_of_customer_revenue: number | null
          pct_of_product_revenue: number | null
          product_name: string | null
          product_ref: string | null
          revenue: number | null
        }
        Relationships: []
      }
      data_quality_scorecard: {
        Row: {
          category: string | null
          description: string | null
          metric: string | null
          severity: string | null
          threshold: number | null
          value: number | null
        }
        Relationships: []
      }
      dead_stock_analysis: {
        Row: {
          category: string | null
          cost_source: string | null
          days_since_last_sale: number | null
          effective_cost: number | null
          historical_customers: number | null
          inventory_value: number | null
          last_sale_date: string | null
          lifetime_revenue: number | null
          list_price: number | null
          odoo_product_id: number | null
          product_name: string | null
          product_ref: string | null
          standard_price: number | null
          stock_qty: number | null
        }
        Relationships: []
      }
      director_health_30d: {
        Row: {
          acted: number | null
          acted_rate_pct: number | null
          active_lessons: number | null
          agent_id: number | null
          archived: number | null
          avg_confidence: number | null
          avg_impact_mxn: number | null
          cap_impact: Json | null
          cap_max_per_run: Json | null
          cap_min_conf: Json | null
          cap_min_impact: Json | null
          dismissed: number | null
          domain: string | null
          expired: number | null
          health_status: string | null
          insights_30d: number | null
          last_run_at: string | null
          max_impact_mxn: number | null
          name: string | null
          open_insights: number | null
          pct_grounded: number | null
          slug: string | null
          total_lessons: number | null
        }
        Relationships: []
      }
      dq_company_duplicates: {
        Row: {
          company_ids: number[] | null
          customer_flags: boolean[] | null
          duplicate_count: number | null
          names: string[] | null
          recommended_keeper_id: number | null
          rfc: string | null
          supplier_flags: boolean[] | null
        }
        Relationships: []
      }
      dq_current_issues: {
        Row: {
          check_name: string | null
          expected: string | null
          message: string | null
          severity: string | null
          value: string | null
        }
        Relationships: []
      }
      dq_invoice_uuid_duplicates: {
        Row: {
          cfdi_uuid: string | null
          duplicate_count: number | null
          invoice_names: string[] | null
          move_type: string | null
          recommended_keeper: number | null
          state: string | null
          total_amount_mxn: number | null
        }
        Relationships: []
      }
      dq_payments_unmatchable: {
        Row: {
          affected_rows: number | null
          fix: string | null
          issue: string | null
        }
        Relationships: []
      }
      dq_product_code_duplicates: {
        Row: {
          active_flags: boolean[] | null
          duplicate_count: number | null
          internal_ref: string | null
          product_ids: number[] | null
          recommended_keeper: number | null
          stock_qtys: number[] | null
        }
        Relationships: []
      }
      gold_balance_sheet: {
        Row: {
          by_bucket: Json | null
          period: string | null
          refreshed_at: string | null
          total_assets: number | null
          total_equity: number | null
          total_liabilities: number | null
          unbalanced_amount: number | null
        }
        Relationships: []
      }
      gold_cashflow: {
        Row: {
          bank_breakdown: Json | null
          current_cash_mxn: number | null
          current_debt_mxn: number | null
          overdue_receivable_mxn: number | null
          refreshed_at: string | null
          total_payable_mxn: number | null
          total_receivable_mxn: number | null
          working_capital_mxn: number | null
        }
        Relationships: []
      }
      gold_ceo_inbox: {
        Row: {
          action_cta: string | null
          age_days: number | null
          assignee_canonical_contact_id: number | null
          assignee_email: string | null
          assignee_name: string | null
          canonical_entity_id: string | null
          canonical_entity_type: string | null
          description: string | null
          detected_at: string | null
          impact_mxn: number | null
          invariant_key: string | null
          issue_id: string | null
          issue_type: string | null
          metadata: Json | null
          priority_score: number | null
          severity: string | null
        }
        Relationships: []
      }
      gold_company_360: {
        Row: {
          ar_aging_buckets: Json | null
          blacklist_action: string | null
          blacklist_level: string | null
          canonical_company_id: number | null
          canonical_name: string | null
          contact_count: number | null
          display_name: string | null
          email_count: number | null
          enriched_at: string | null
          has_manual_override: boolean | null
          has_shadow_flag: boolean | null
          invoices_count: number | null
          invoices_with_cfdi: number | null
          invoices_with_syntage_match: number | null
          is_customer: boolean | null
          is_internal: boolean | null
          is_supplier: boolean | null
          key_products: Json | null
          last_data_refresh_at: string | null
          last_email_at: string | null
          last_invoice_date: string | null
          late_deliveries_count: number | null
          lifetime_value_mxn: number | null
          max_days_overdue: number | null
          open_company_issues_count: number | null
          opinion_cumplimiento: string | null
          opportunity_signals: Json | null
          otd_rate: number | null
          otd_rate_90d: number | null
          overdue_amount_mxn: number | null
          overdue_count: number | null
          purchase_orders_12m: number | null
          refreshed_at: string | null
          relationship_summary: string | null
          relationship_type: string | null
          revenue_90d_mxn: number | null
          revenue_prior_90d_mxn: number | null
          revenue_share_pct: number | null
          revenue_ytd_mxn: number | null
          rfc: string | null
          risk_level: string | null
          risk_signals: Json | null
          sales_orders_12m: number | null
          sat_compliance_score: number | null
          sat_open_issues_count: number | null
          tier: string | null
          total_deliveries_count: number | null
          total_payable_mxn: number | null
          total_pending_mxn: number | null
          total_receivable_mxn: number | null
          trend_pct: number | null
        }
        Insert: {
          ar_aging_buckets?: Json | null
          blacklist_action?: string | null
          blacklist_level?: string | null
          canonical_company_id?: number | null
          canonical_name?: string | null
          contact_count?: number | null
          display_name?: string | null
          email_count?: number | null
          enriched_at?: string | null
          has_manual_override?: boolean | null
          has_shadow_flag?: boolean | null
          invoices_count?: number | null
          invoices_with_cfdi?: number | null
          invoices_with_syntage_match?: number | null
          is_customer?: boolean | null
          is_internal?: boolean | null
          is_supplier?: boolean | null
          key_products?: Json | null
          last_data_refresh_at?: string | null
          last_email_at?: string | null
          last_invoice_date?: string | null
          late_deliveries_count?: number | null
          lifetime_value_mxn?: number | null
          max_days_overdue?: number | null
          open_company_issues_count?: never
          opinion_cumplimiento?: string | null
          opportunity_signals?: Json | null
          otd_rate?: number | null
          otd_rate_90d?: number | null
          overdue_amount_mxn?: number | null
          overdue_count?: number | null
          purchase_orders_12m?: never
          refreshed_at?: never
          relationship_summary?: string | null
          relationship_type?: string | null
          revenue_90d_mxn?: number | null
          revenue_prior_90d_mxn?: number | null
          revenue_share_pct?: number | null
          revenue_ytd_mxn?: number | null
          rfc?: string | null
          risk_level?: string | null
          risk_signals?: Json | null
          sales_orders_12m?: never
          sat_compliance_score?: number | null
          sat_open_issues_count?: number | null
          tier?: string | null
          total_deliveries_count?: number | null
          total_payable_mxn?: number | null
          total_pending_mxn?: number | null
          total_receivable_mxn?: number | null
          trend_pct?: number | null
        }
        Update: {
          ar_aging_buckets?: Json | null
          blacklist_action?: string | null
          blacklist_level?: string | null
          canonical_company_id?: number | null
          canonical_name?: string | null
          contact_count?: number | null
          display_name?: string | null
          email_count?: number | null
          enriched_at?: string | null
          has_manual_override?: boolean | null
          has_shadow_flag?: boolean | null
          invoices_count?: number | null
          invoices_with_cfdi?: number | null
          invoices_with_syntage_match?: number | null
          is_customer?: boolean | null
          is_internal?: boolean | null
          is_supplier?: boolean | null
          key_products?: Json | null
          last_data_refresh_at?: string | null
          last_email_at?: string | null
          last_invoice_date?: string | null
          late_deliveries_count?: number | null
          lifetime_value_mxn?: number | null
          max_days_overdue?: number | null
          open_company_issues_count?: never
          opinion_cumplimiento?: string | null
          opportunity_signals?: Json | null
          otd_rate?: number | null
          otd_rate_90d?: number | null
          overdue_amount_mxn?: number | null
          overdue_count?: number | null
          purchase_orders_12m?: never
          refreshed_at?: never
          relationship_summary?: string | null
          relationship_type?: string | null
          revenue_90d_mxn?: number | null
          revenue_prior_90d_mxn?: number | null
          revenue_share_pct?: number | null
          revenue_ytd_mxn?: number | null
          rfc?: string | null
          risk_level?: string | null
          risk_signals?: Json | null
          sales_orders_12m?: never
          sat_compliance_score?: number | null
          sat_open_issues_count?: number | null
          tier?: string | null
          total_deliveries_count?: number | null
          total_payable_mxn?: number | null
          total_pending_mxn?: number | null
          total_receivable_mxn?: number | null
          trend_pct?: number | null
        }
        Relationships: []
      }
      gold_pl_statement: {
        Row: {
          by_level_1: Json | null
          net_income: number | null
          period: string | null
          refreshed_at: string | null
          total_expense: number | null
          total_income: number | null
        }
        Relationships: []
      }
      gold_product_performance: {
        Row: {
          available_qty: number | null
          canonical_product_id: number | null
          category: string | null
          display_name: string | null
          fiscal_map_confidence: string | null
          internal_ref: string | null
          is_active: boolean | null
          list_price_mxn: number | null
          margin_pct_12m: number | null
          odoo_revenue_12m_mxn: number | null
          refreshed_at: string | null
          sat_clave_prod_serv: string | null
          sat_revenue_12m_mxn: number | null
          standard_price_mxn: number | null
          stock_qty: number | null
          top_customers_canonical_ids: number[] | null
          top_suppliers_canonical_ids: number[] | null
          unique_customers_12m: number | null
          units_sold_12m: number | null
        }
        Relationships: []
      }
      gold_reconciliation_health: {
        Row: {
          auto_resolved_24h: number | null
          critical_open: number | null
          high_open: number | null
          last_30d_trend: Json | null
          new_24h: number | null
          refreshed_at: string | null
          top_invariants: Json | null
          total_open: number | null
          total_open_impact_mxn: number | null
        }
        Relationships: []
      }
      gold_revenue_monthly: {
        Row: {
          canonical_company_id: number | null
          company_name: string | null
          invoices_count: number | null
          month_start: string | null
          odoo_mxn: number | null
          refreshed_at: string | null
          residual_mxn: number | null
          resolved_mxn: number | null
          sat_mxn: number | null
          source_pattern: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_ci_receptor"
            columns: ["canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ci_receptor"
            columns: ["canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_crm_leads"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ci_receptor"
            columns: ["canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_deliveries"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ci_receptor"
            columns: ["canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_order_lines"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ci_receptor"
            columns: ["canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_purchase_orders"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ci_receptor"
            columns: ["canonical_company_id"]
            isOneToOne: false
            referencedRelation: "canonical_sale_orders"
            referencedColumns: ["canonical_company_id"]
          },
          {
            foreignKeyName: "fk_ci_receptor"
            columns: ["canonical_company_id"]
            isOneToOne: false
            referencedRelation: "gold_company_360"
            referencedColumns: ["canonical_company_id"]
          },
        ]
      }
      inventory_velocity: {
        Row: {
          abc_placeholder: string | null
          annual_turnover: number | null
          available_qty: number | null
          avg_cost: number | null
          category: string | null
          cost_source: string | null
          customers_12m: number | null
          daily_run_rate: number | null
          days_of_stock: number | null
          effective_cost: number | null
          last_sale_date: string | null
          odoo_product_id: number | null
          product_name: string | null
          product_ref: string | null
          qty_sold_180d: number | null
          qty_sold_365d: number | null
          qty_sold_90d: number | null
          reorder_max: number | null
          reorder_min: number | null
          reorder_status: string | null
          reserved_qty: number | null
          standard_price: number | null
          stock_qty: number | null
          stock_value: number | null
        }
        Relationships: []
      }
      invoice_line_margins: {
        Row: {
          below_cost: boolean | null
          company_name: string | null
          cost_source: string | null
          discount: number | null
          gross_margin_pct: number | null
          id: number | null
          invoice_date: string | null
          margin_total: number | null
          move_name: string | null
          odoo_partner_id: number | null
          price_subtotal: number | null
          price_unit: number | null
          product_name: string | null
          product_ref: string | null
          quantity: number | null
          unit_cost: number | null
        }
        Relationships: []
      }
      journal_flow_profile: {
        Row: {
          avg_monthly_amount: number | null
          journal_name: string | null
          months_active: number | null
          payment_type: string | null
          stddev_monthly_amount: number | null
          top5_partner_ids: number[] | null
          total_amount_12m: number | null
          total_payments_12m: number | null
          volatility_cv: number | null
        }
        Relationships: []
      }
      odoo_push_last_events: {
        Row: {
          created_at: string | null
          elapsed_s: number | null
          error: string | null
          full_push: boolean | null
          level: string | null
          message: string | null
          method: string | null
          rows_pushed: number | null
          status: string | null
        }
        Relationships: []
      }
      odoo_sync_freshness: {
        Row: {
          expected_hours: number | null
          hours_ago: number | null
          last_sync: string | null
          minutes_ago: number | null
          row_count: number | null
          status: string | null
          table_name: string | null
        }
        Relationships: []
      }
      ops_delivery_health_weekly: {
        Row: {
          avg_lead_days: number | null
          computed_at: string | null
          late: number | null
          no_scheduled_date: number | null
          on_time: number | null
          otd_pct: number | null
          total_completed: number | null
          week_start: string | null
        }
        Relationships: []
      }
      overhead_factor_12m: {
        Row: {
          computed_at: string | null
          material_margin_pct_avg: number | null
          overhead_cost_12m: number | null
          overhead_factor_pct: number | null
          real_gross_margin_pct: number | null
          total_cogs_pl: number | null
          total_gross_profit_pl: number | null
          total_material_cost: number | null
          total_revenue_lines: number | null
          total_revenue_pl: number | null
        }
        Relationships: []
      }
      payment_predictions: {
        Row: {
          avg_days_to_pay: number | null
          avg_older: number | null
          avg_recent_6m: number | null
          company_id: number | null
          company_name: string | null
          fastest_payment: number | null
          max_days_overdue: number | null
          median_days_to_pay: number | null
          oldest_due_date: string | null
          paid_invoices: number | null
          payment_risk: string | null
          payment_trend: string | null
          pending_count: number | null
          predicted_payment_date: string | null
          slowest_payment: number | null
          stddev_days: number | null
          tier: string | null
          total_pending: number | null
        }
        Relationships: [
          {
            foreignKeyName: "odoo_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odoo_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_69b_status"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "customer_product_matrix"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "odoo_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "stockout_queue"
            referencedColumns: ["last_supplier_id"]
          },
        ]
      }
      product_real_cost: {
        Row: {
          active_boms_for_product: number | null
          bom_type: string | null
          bom_yield: number | null
          cached_standard_price: number | null
          computed_at: string | null
          delta_vs_cached_pct: number | null
          distinct_raw_components: number | null
          has_missing_costs: boolean | null
          has_multiple_boms: boolean | null
          material_cost_total: number | null
          max_depth: number | null
          missing_cost_components: number | null
          odoo_bom_id: number | null
          odoo_product_id: number | null
          product_name: string | null
          product_ref: string | null
          raw_components_count: number | null
          real_unit_cost: number | null
        }
        Relationships: []
      }
      production_delays: {
        Row: {
          assigned_user: string | null
          customer_company_id: number | null
          customer_name: string | null
          date_finished: string | null
          date_start: string | null
          days_late: number | null
          id: number | null
          is_overdue: boolean | null
          is_underproduced: boolean | null
          mo_name: string | null
          odoo_production_id: number | null
          origin: string | null
          product_name: string | null
          qty_planned: number | null
          qty_produced: number | null
          sale_order_id: number | null
          salesperson_email: string | null
          salesperson_name: string | null
          so_amount_mxn: number | null
          so_commitment_date: string | null
          so_date_order: string | null
          state: string | null
        }
        Relationships: []
      }
      purchase_price_intelligence: {
        Row: {
          avg_price: number | null
          avg_qty: number | null
          currency: string | null
          first_purchase_date: string | null
          last_order_name: string | null
          last_price: number | null
          last_purchase_date: string | null
          last_qty: number | null
          last_supplier: string | null
          max_price: number | null
          max_qty: number | null
          min_price: number | null
          min_qty: number | null
          odoo_product_id: number | null
          prev_price: number | null
          price_change_pct: number | null
          price_flag: string | null
          price_stddev: number | null
          price_vs_avg_pct: number | null
          product_name: string | null
          product_ref: string | null
          qty_flag: string | null
          qty_vs_avg_pct: number | null
          supplier_count: number | null
          total_purchases: number | null
          total_spent: number | null
          total_spent_mxn: number | null
          total_spent_native: number | null
        }
        Relationships: []
      }
      real_sale_price: {
        Row: {
          computed_at: string | null
          cost_source: string | null
          customers_12m: number | null
          cv_12m: number | null
          last_sale_date: string | null
          list_price_is_stale: boolean | null
          markup_vs_cost_pct: number | null
          max_price_12m: number | null
          min_price_12m: number | null
          odoo_cost: number | null
          odoo_product_id: number | null
          price_12m: number | null
          price_180d: number | null
          price_90d: number | null
          price_current: number | null
          product_name: string | null
          product_ref: string | null
          qty_sold_12m: number | null
          qty_sold_90d: number | null
          revenue_12m: number | null
          sale_lines_12m: number | null
          stddev_12m: number | null
        }
        Relationships: []
      }
      salesperson_workload_30d: {
        Row: {
          department: string | null
          email: string | null
          odoo_user_id: number | null
          open_order_value: number | null
          open_orders: number | null
          orders_30d: number | null
          overdue_activities: number | null
          overdue_activities_pct: number | null
          revenue_30d: number | null
          salesperson_name: string | null
          total_activities: number | null
          workload_stress_score: number | null
        }
        Relationships: []
      }
      stockout_queue: {
        Row: {
          available_qty: number | null
          category: string | null
          daily_run_rate: number | null
          days_of_stock: number | null
          last_purchase_date: string | null
          last_purchase_price: number | null
          last_supplier_id: number | null
          last_supplier_name: string | null
          odoo_product_id: number | null
          priority_score: number | null
          product_name: string | null
          product_ref: string | null
          qty_on_order: number | null
          qty_sold_90d: number | null
          replenish_cost_mxn: number | null
          reserved_qty: number | null
          revenue_at_risk_30d_mxn: number | null
          stock_qty: number | null
          suggested_order_qty: number | null
          top_consumer: string | null
          urgency: string | null
        }
        Relationships: []
      }
      syntage_client_cancellation_rates: {
        Row: {
          cancelados_24m: number | null
          cancellation_rate_pct: number | null
          cancelled_amount_mxn: number | null
          company_id: number | null
          name: string | null
          rfc: string | null
          total_cfdis_24m: number | null
        }
        Relationships: []
      }
      syntage_product_line_analysis: {
        Row: {
          cantidad_total: number | null
          cfdis_distintos: number | null
          clave_prod_serv: string | null
          descripcion: string | null
          precio_max_mxn: number | null
          precio_min_mxn: number | null
          precio_promedio_mxn: number | null
          precio_stddev: number | null
          revenue_mxn_aprox: number | null
          total_lineas: number | null
        }
        Relationships: []
      }
      syntage_revenue_fiscal_monthly: {
        Row: {
          cancelados: number | null
          cfdis_emitidos: number | null
          cfdis_recibidos: number | null
          clientes_unicos: number | null
          gasto_mxn: number | null
          iva_trasladado_mxn: number | null
          month: string | null
          proveedores_unicos: number | null
          retenciones_mxn: number | null
          revenue_mxn: number | null
        }
        Relationships: []
      }
      syntage_top_clients_fiscal_lifetime: {
        Row: {
          cancellation_rate_pct: number | null
          cancelled_count: number | null
          company_id: number | null
          days_since_last_cfdi: number | null
          first_cfdi: string | null
          last_cfdi: string | null
          lifetime_revenue_mxn: number | null
          name: string | null
          revenue_12m_mxn: number | null
          revenue_prev_12m_mxn: number | null
          rfc: string | null
          total_cfdis: number | null
          yoy_pct: number | null
        }
        Relationships: []
      }
      syntage_top_suppliers_fiscal_lifetime: {
        Row: {
          company_id: number | null
          days_since_last_cfdi: number | null
          first_cfdi: string | null
          last_cfdi: string | null
          lifetime_spend_mxn: number | null
          name: string | null
          retenciones_lifetime_mxn: number | null
          rfc: string | null
          spend_12m_mxn: number | null
          spend_prev_12m_mxn: number | null
          total_cfdis: number | null
          yoy_pct: number | null
        }
        Relationships: []
      }
      v_audit_account_balances_buckets: {
        Row: {
          balance: number | null
          bucket_key: string | null
          invariant_key: string | null
          odoo_company_id: number | null
          period: string | null
        }
        Relationships: []
      }
      v_audit_account_balances_orphan_account: {
        Row: {
          account_code: string | null
          odoo_account_id: number | null
          orphan_rows: number | null
        }
        Relationships: []
      }
      v_audit_account_balances_trial_balance: {
        Row: {
          odoo_company_id: number | null
          period: string | null
          total: number | null
        }
        Relationships: []
      }
      v_audit_company_leak_invoice_lines: {
        Row: {
          header_company: number | null
          line_company: number | null
          line_id: number | null
        }
        Relationships: []
      }
      v_audit_company_leak_order_lines: {
        Row: {
          header_company: number | null
          line_company: number | null
          line_id: number | null
          order_type: string | null
        }
        Relationships: []
      }
      v_audit_deliveries_buckets: {
        Row: {
          bucket_key: string | null
          count: number | null
        }
        Relationships: []
      }
      v_audit_deliveries_done_without_date: {
        Row: {
          date_done: string | null
          id: number | null
          state: string | null
        }
        Insert: {
          date_done?: string | null
          id?: number | null
          state?: string | null
        }
        Update: {
          date_done?: string | null
          id?: number | null
          state?: string | null
        }
        Relationships: []
      }
      v_audit_deliveries_orphan_partner: {
        Row: {
          delivery_id: number | null
          odoo_partner_id: number | null
        }
        Relationships: []
      }
      v_audit_invoice_lines_buckets: {
        Row: {
          bucket_key: string | null
          count: number | null
          date_from: string | null
          date_to: string | null
          move_type: string | null
          odoo_company_id: number | null
          sum_qty: number | null
          sum_subtotal_mxn: number | null
        }
        Relationships: []
      }
      v_audit_invoice_lines_fx_present: {
        Row: {
          currency: string | null
          line_id: number | null
          odoo_move_id: number | null
          price_subtotal: number | null
          price_subtotal_mxn: number | null
        }
        Insert: {
          currency?: string | null
          line_id?: number | null
          odoo_move_id?: number | null
          price_subtotal?: number | null
          price_subtotal_mxn?: number | null
        }
        Update: {
          currency?: string | null
          line_id?: number | null
          odoo_move_id?: number | null
          price_subtotal?: number | null
          price_subtotal_mxn?: number | null
        }
        Relationships: []
      }
      v_audit_invoice_lines_fx_sanity: {
        Row: {
          line_id: number | null
        }
        Relationships: []
      }
      v_audit_invoice_lines_price_recompute: {
        Row: {
          discount: number | null
          drift: number | null
          line_id: number | null
          odoo_move_id: number | null
          price_subtotal: number | null
          price_unit: number | null
          quantity: number | null
        }
        Insert: {
          discount?: number | null
          drift?: never
          line_id?: number | null
          odoo_move_id?: number | null
          price_subtotal?: number | null
          price_unit?: number | null
          quantity?: number | null
        }
        Update: {
          discount?: number | null
          drift?: never
          line_id?: number | null
          odoo_move_id?: number | null
          price_subtotal?: number | null
          price_unit?: number | null
          quantity?: number | null
        }
        Relationships: []
      }
      v_audit_invoice_lines_reversal_sign: {
        Row: {
          line_id: number | null
          move_type: string | null
          odoo_move_id: number | null
          price_subtotal: number | null
          quantity: number | null
        }
        Relationships: []
      }
      v_audit_manufacturing_buckets: {
        Row: {
          bucket_key: string | null
          count: number | null
          sum_qty: number | null
        }
        Relationships: []
      }
      v_audit_order_lines_buckets: {
        Row: {
          bucket_key: string | null
          count: number | null
          odoo_company_id: number | null
          order_type: string | null
          sum_qty: number | null
          sum_subtotal_mxn: number | null
        }
        Relationships: []
      }
      v_audit_order_lines_orphan_product: {
        Row: {
          line_id: number | null
          odoo_order_id: number | null
          odoo_product_id: number | null
          order_type: string | null
        }
        Relationships: []
      }
      v_audit_order_lines_orphan_purchase: {
        Row: {
          line_id: number | null
          odoo_order_id: number | null
        }
        Relationships: []
      }
      v_audit_order_lines_orphan_sale: {
        Row: {
          line_id: number | null
          odoo_order_id: number | null
        }
        Relationships: []
      }
      v_audit_products_duplicate_default_code: {
        Row: {
          dupes: number | null
          internal_ref: string | null
          product_ids: number[] | null
        }
        Relationships: []
      }
      v_audit_products_null_standard_price: {
        Row: {
          id: number | null
          internal_ref: string | null
          name: string | null
        }
        Insert: {
          id?: number | null
          internal_ref?: string | null
          name?: string | null
        }
        Update: {
          id?: number | null
          internal_ref?: string | null
          name?: string | null
        }
        Relationships: []
      }
      v_audit_products_null_uom: {
        Row: {
          id: number | null
          internal_ref: string | null
          name: string | null
        }
        Insert: {
          id?: number | null
          internal_ref?: string | null
          name?: string | null
        }
        Update: {
          id?: number | null
          internal_ref?: string | null
          name?: string | null
        }
        Relationships: []
      }
      weekly_trends: {
        Row: {
          company_name: string | null
          late_delta: number | null
          overdue_delta: number | null
          overdue_now: number | null
          pending_delta: number | null
          tier: string | null
          trend_signal: string | null
        }
        Relationships: []
      }
      working_capital_cycle: {
        Row: {
          ap_mxn: number | null
          ar_mxn: number | null
          ccc_days: number | null
          cogs_12m_mxn: number | null
          computed_at: string | null
          dio_days: number | null
          dpo_days: number | null
          dso_days: number | null
          gross_margin_pct: number | null
          gross_profit_12m_mxn: number | null
          inventory_from_bom_mxn: number | null
          inventory_from_standard_mxn: number | null
          inventory_mxn: number | null
          revenue_12m_mxn: number | null
          working_capital_mxn: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _audit_register_invariant: {
        Args: {
          p_count: number
          p_date_from: string
          p_date_to: string
          p_key: string
          p_model: string
          p_run_id: string
          p_severity?: string
        }
        Returns: undefined
      }
      _sp4_run_extra: { Args: { p_key?: string }; Returns: Json }
      auto_expire_stale_tasks: { Args: never; Returns: Json }
      backfill_company_financials: { Args: { data: Json }; Returns: undefined }
      backfill_enrichment_status: { Args: never; Returns: Json }
      backfill_enrichment_status_v2: {
        Args: { batch_size?: number }
        Returns: Json
      }
      backfill_rfc_from_json: { Args: { data: Json }; Returns: number }
      cashflow_runway: { Args: never; Returns: Json }
      cleanup_stale_data: { Args: never; Returns: Json }
      company_evidence_pack: { Args: { p_company_id: number }; Returns: Json }
      compute_priority_scores: { Args: never; Returns: number }
      data_quality_alerts: {
        Args: never
        Returns: {
          category: string
          description: string
          metric: string
          severity: string
          threshold: number
          value: number
        }[]
      }
      decay_fact_confidence: {
        Args: { p_decay_rate?: number; p_min_confidence?: number }
        Returns: number
      }
      deduplicate_all: {
        Args: never
        Returns: {
          companies_merged: number
          entities_merged: number
        }[]
      }
      dependents_of: {
        Args: { obj_name: string; obj_schema?: string }
        Returns: {
          dep_def: string
          dep_kind: string
          dep_name: string
          depth: number
        }[]
      }
      dq_cron_integrity_check: { Args: never; Returns: Json }
      dq_invariants: {
        Args: never
        Returns: {
          check_name: string
          expected: string
          message: string
          ok: boolean
          severity: string
          value: string
        }[]
      }
      enrich_companies: { Args: never; Returns: Json }
      enrich_company_industry_from_transactions: {
        Args: never
        Returns: {
          company_id: number
          company_name: string
          confidence: string
          suggested_industry: string
        }[]
      }
      enrich_contacts_from_emails: {
        Args: { batch_size?: number }
        Returns: {
          contact_id: string
          source_email_id: string
          suggested_name: string
        }[]
      }
      enrich_emails_company_by_domain: { Args: never; Returns: Json }
      execute_safe_ddl: {
        Args: { p_change_type?: string; p_description: string; p_sql: string }
        Returns: Json
      }
      extract_email: { Args: { raw: string }; Returns: string }
      find_duplicate_entities: {
        Args: never
        Returns: {
          id_a: number
          id_b: number
          name_a: string
          name_b: string
          similarity: number
          type_a: string
          type_b: string
        }[]
      }
      generate_daily_digest: { Args: never; Returns: Json }
      get_agents_overview: {
        Args: never
        Returns: {
          agent_id: number
          avg_confidence: number
          domain: string
          is_active: boolean
          last_run_at: string
          last_run_status: string
          name: string
          new_insights: number
          slug: string
          total_insights: number
          total_runs: number
        }[]
      }
      get_alert_actions: {
        Args: { p_alert_id: number }
        Returns: {
          action_category: string | null
          action_type: string
          alert_id: number | null
          assignee_email: string | null
          assignee_name: string | null
          company_id: number | null
          completed_at: string | null
          contact_company: string | null
          contact_id: number | null
          contact_name: string | null
          created_at: string
          description: string
          due_date: string | null
          id: number
          prediction_confidence: number | null
          priority: string
          reason: string | null
          source_id: number | null
          state: string
          thread_id: number | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "action_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_alert_with_context: { Args: { p_alert_id: number }; Returns: Json }
      get_cashflow_recommendations: { Args: never; Returns: Json }
      get_communication_network: {
        Args: {
          p_company_id?: number
          p_internal_only?: boolean
          p_min_emails?: number
        }
        Returns: Json
      }
      get_company_financials: { Args: { p_company_id: number }; Returns: Json }
      get_company_full_context: {
        Args: { p_company_id: number }
        Returns: Json
      }
      get_company_logistics: { Args: { p_company_id: number }; Returns: Json }
      get_company_pipeline: { Args: { p_company_id: number }; Returns: Json }
      get_company_products: { Args: { p_company_id: number }; Returns: Json }
      get_company_relationships: {
        Args: { p_entity_id: number }
        Returns: {
          context: string
          entity_a_id: number
          entity_b_id: number
          first_seen: string
          id: number
          interaction_count: number
          last_seen: string
          related_entity: Json
          relationship_type: string
          strength: number
        }[]
      }
      get_company_revenue: {
        Args: { p_company_name: string; p_months?: number }
        Returns: Json
      }
      get_contact_communications: {
        Args: { p_contact_email: string }
        Returns: Json
      }
      get_contact_health_history: {
        Args: { p_contact_id: number; p_days?: number }
        Returns: Json
      }
      get_contact_intelligence: {
        Args: { p_contact_email: string }
        Returns: Json
      }
      get_contacts_health_stats: { Args: never; Returns: Json }
      get_dashboard_cash_kpi: { Args: never; Returns: Json }
      get_dashboard_kpis: { Args: never; Returns: Json }
      get_decision_inbox: {
        Args: { p_limit?: number }
        Returns: {
          alert_id: number
          assignee_email: string
          assignee_name: string
          business_value_at_risk: number
          company_id: number
          contact_id: number
          contact_name: string
          created_at: string
          description: string
          due_date: string
          id: number
          impact_score: number
          item_type: string
          priority: string
          severity: string
          state: string
          suggested_action: string
          thread_id: number
          title: string
          urgency_score: number
        }[]
      }
      get_director_briefing: {
        Args: { p_director: string; p_max_companies?: number }
        Returns: Json
      }
      get_director_dashboard: { Args: never; Returns: Json }
      get_entity_intelligence: { Args: { p_entity_id: number }; Returns: Json }
      get_entity_network: {
        Args: { p_depth?: number; p_entity_id: number }
        Returns: {
          entity_id: number
          entity_name: string
          entity_type: string
          related_to: number
          relationship: string
          strength: number
        }[]
      }
      get_fiscal_annotation: { Args: { p_company_id: number }; Returns: Json }
      get_identity_gaps: { Args: never; Returns: Json }
      get_projected_cash_flow: { Args: never; Returns: Json }
      get_projected_cash_flow_summary: { Args: never; Returns: Json }
      get_syntage_reconciliation_summary: { Args: never; Returns: Json }
      get_thread_counts: {
        Args: never
        Returns: {
          stalled_24h: number
          stalled_72h: number
          total: number
        }[]
      }
      get_volume_trend: { Args: { p_days?: number }; Returns: Json }
      increment_memory_usage: {
        Args: { memory_ids: number[] }
        Returns: undefined
      }
      ingestion_complete_run: {
        Args: { p_high_watermark: string; p_run_id: string; p_status: string }
        Returns: undefined
      }
      ingestion_fetch_pending_failures: {
        Args: {
          p_limit: number
          p_max_retries: number
          p_source: string
          p_table: string
        }
        Returns: unknown[]
        SetofOptions: {
          from: "*"
          to: "sync_failure"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      ingestion_list_active_sources: {
        Args: { p_source: string }
        Returns: {
          on_conflict_cols: string
          table_name: string
        }[]
      }
      ingestion_mark_failure_resolved: {
        Args: { p_failure_id: string }
        Returns: undefined
      }
      ingestion_report_batch: {
        Args: {
          p_attempted: number
          p_failed: number
          p_run_id: string
          p_succeeded: number
        }
        Returns: undefined
      }
      ingestion_report_failure: {
        Args: {
          p_entity_id: string
          p_error_code: string
          p_error_detail: string
          p_payload: Json
          p_run_id: string
        }
        Returns: string
      }
      ingestion_report_source_count: {
        Args: {
          p_missing_entity_ids: string[]
          p_source: string
          p_source_count: number
          p_table: string
          p_window_end: string
          p_window_start: string
        }
        Returns: string
      }
      ingestion_start_run: {
        Args: {
          p_run_type: string
          p_source: string
          p_table: string
          p_triggered_by: string
        }
        Returns: {
          last_watermark: string
          run_id: string
        }[]
      }
      link_orphan_emails_to_companies: {
        Args: never
        Returns: {
          emails_linked: number
          emails_remaining: number
        }[]
      }
      link_orphan_emails_to_contacts: {
        Args: never
        Returns: {
          emails_linked: number
          emails_processed: number
        }[]
      }
      link_orphan_insights: { Args: never; Returns: number }
      match_emails_company_via_contact: { Args: never; Returns: Json }
      match_emails_to_companies_by_domain: {
        Args: { batch_size?: number }
        Returns: {
          matched_emails: number
          updated_count: number
        }[]
      }
      match_emails_to_companies_by_from_domain: {
        Args: { batch_limit?: number }
        Returns: {
          updated_count: number
        }[]
      }
      match_emails_to_contacts_by_domain: {
        Args: { batch_limit?: number }
        Returns: {
          updated_count: number
        }[]
      }
      match_emails_to_contacts_by_email: {
        Args: { batch_size?: number }
        Returns: Json
      }
      match_emails_to_contacts_exact: { Args: never; Returns: Json }
      match_unlinked_invoices_by_composite: {
        Args: {
          p_amount_tolerance?: number
          p_batch_size?: number
          p_date_tolerance_days?: number
        }
        Returns: {
          amount_mxn: number
          emisor_rfc: string
          invoice_date: string
          match_confidence: string
          odoo_invoice_id: number
          syntage_uuid: string
        }[]
      }
      matcher_all_pending: {
        Args: never
        Returns: {
          attempted: number
          entity: string
          resolved: number
        }[]
      }
      matcher_company: {
        Args: {
          p_autocreate_shadow?: boolean
          p_domain?: string
          p_name?: string
          p_rfc: string
        }
        Returns: number
      }
      matcher_company_if_new_rfc: {
        Args: {
          p_emisor_nombre: string
          p_emisor_rfc: string
          p_receptor_nombre: string
          p_receptor_rfc: string
        }
        Returns: undefined
      }
      matcher_contact: {
        Args: { p_domain?: string; p_email: string; p_name?: string }
        Returns: number
      }
      matcher_invoice_quick: { Args: { p_uuid: string }; Returns: undefined }
      matcher_product: {
        Args: { p_internal_ref: string; p_name?: string }
        Returns: number
      }
      mdm_link_invoice: {
        Args: {
          p_canonical_id: string
          p_note?: string
          p_odoo_invoice_id?: number
          p_sat_uuid: string
          p_user_email?: string
        }
        Returns: undefined
      }
      mdm_merge_companies: {
        Args: {
          p_canonical_a: number
          p_canonical_b: number
          p_note?: string
          p_user_email: string
        }
        Returns: number
      }
      mdm_revoke_override: {
        Args: { p_override_id: number; p_reason: string; p_user_email: string }
        Returns: undefined
      }
      merge_entities: {
        Args: { p_keep_id: number; p_remove_id: number }
        Returns: undefined
      }
      reconcile_invoice_manually: {
        Args: {
          p_linked_by: string
          p_note?: string
          p_odoo_invoice_id: number
          p_syntage_uuid: string
        }
        Returns: number
      }
      reconcile_payment_manually: {
        Args: {
          p_linked_by: string
          p_note?: string
          p_odoo_payment_id: number
          p_syntage_complemento_uuid: string
        }
        Returns: number
      }
      refresh_accounting_anomalies: { Args: never; Returns: undefined }
      refresh_all_analytics_robust: {
        Args: { p_concurrent?: boolean }
        Returns: Json
      }
      refresh_all_matviews: { Args: never; Returns: Json }
      refresh_cashflow_profiles: {
        Args: never
        Returns: {
          refreshed_at: string
          row_count: number
          view_name: string
        }[]
      }
      refresh_cashflow_projection: { Args: never; Returns: undefined }
      refresh_communication_edges: { Args: never; Returns: Json }
      refresh_company_handlers: { Args: never; Returns: undefined }
      refresh_company_narrative: { Args: never; Returns: undefined }
      refresh_company_profile: { Args: never; Returns: undefined }
      refresh_contact_360: {
        Args: { p_contact_email?: string }
        Returns: undefined
      }
      refresh_product_intelligence: { Args: never; Returns: undefined }
      refresh_purchase_intelligence: { Args: never; Returns: undefined }
      refresh_real_sale_price: { Args: never; Returns: undefined }
      refresh_reorder_predictions: { Args: never; Returns: undefined }
      refresh_rfm_segments: { Args: never; Returns: undefined }
      refresh_supplier_price_index: { Args: never; Returns: undefined }
      relink_orphan_emails: { Args: never; Returns: number }
      resolve_all_company_links: { Args: never; Returns: number }
      resolve_all_connections: { Args: never; Returns: Json }
      resolve_all_identities: { Args: never; Returns: Json }
      resolve_amount_mismatch_for_invoice: {
        Args: { p_odoo_invoice_id: number }
        Returns: number
      }
      resolve_assignee_emails: { Args: never; Returns: number }
      resolve_cancelled_but_posted: {
        Args: {
          p_cfdi_uuid: string
          p_odoo_invoice_id: number
          p_reason: string
        }
        Returns: number
      }
      resolve_company_by_name: { Args: { p_name: string }; Returns: number }
      resolve_company_from_text: { Args: { p_text: string }; Returns: number }
      resolve_complemento_missing_payment_for_link: {
        Args: { p_invoice_id: number }
        Returns: number
      }
      resolve_contact_by_email: {
        Args: { p_email: string }
        Returns: {
          company_id: number
          contact_id: number
        }[]
      }
      resolve_email_recipients: { Args: never; Returns: Json }
      resolve_identities: { Args: never; Returns: Json }
      resolve_payment_missing_complemento_for_syntage_payment: {
        Args: { p_syntage_id: string }
        Returns: number
      }
      resolve_pending_follow_ups: { Args: never; Returns: Json }
      rpc_mark_unresolved_emails: { Args: never; Returns: number }
      run_director_daily_analysis: {
        Args: { p_director_slug?: string; p_run_date?: string }
        Returns: Json
      }
      run_internal_audits: {
        Args: { p_date_from: string; p_date_to: string; p_run_id: string }
        Returns: Json
      }
      run_reconciliation: { Args: { p_key?: string }; Returns: Json }
      run_reconciliation_sp2: {
        Args: { p_key?: string }
        Returns: {
          auto_resolved: number
          invariant_key: string
          new_issues: number
        }[]
      }
      safe_recreate_matview: {
        Args: { new_def: string; target_name: string; target_schema?: string }
        Returns: Json
      }
      search_global: {
        Args: { max_results?: number; query: string }
        Returns: Json
      }
      search_similar_emails: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          email_date: string
          id: number
          sender: string
          similarity: number
          snippet: string
          subject: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      snap_to_day_of_month: {
        Args: { base_date: string; target_day: number }
        Returns: string
      }
      sp5_assign_issues: { Args: never; Returns: number }
      syntage_open_issues_by_week: {
        Args: never
        Returns: {
          cnt: number
          severity: string
          week: string
        }[]
      }
      syntage_recent_resolutions: {
        Args: { p_days?: number }
        Returns: {
          cnt: number
          resolution: string
        }[]
      }
      syntage_recent_tax_returns: {
        Args: { p_months?: number }
        Returns: {
          fecha_presentacion: string
          impuesto: string
          monto_pagado: number
          period: string
          return_type: string
          tipo_declaracion: string
        }[]
      }
      syntage_top_unlinked_rfcs: {
        Args: { p_limit?: number }
        Returns: {
          cnt: number
          last_seen: string
          rfc: string
        }[]
      }
      syntage_validation_coverage_by_month: {
        Args: { p_months?: number }
        Returns: {
          month: string
          posted: number
          ratio: number
          validated: number
        }[]
      }
      take_daily_snapshot: { Args: never; Returns: Json }
      top_actionable_insights: {
        Args: { p_limit?: number }
        Returns: {
          agent_name: string
          agent_slug: string
          assignee_department: string
          assignee_name: string
          business_impact_estimate: number
          category: string
          company_id: number
          company_name: string
          confidence: number
          description: string
          hours_old: number
          id: number
          score: number
          severity: string
          title: string
        }[]
      }
      uom_category: { Args: { uom_name: string }; Returns: string }
      update_invoice_cfdi_states_bulk: { Args: { p_data: Json }; Returns: Json }
      upsert_contact: {
        Args: {
          p_company?: string
          p_contact_type?: string
          p_department?: string
          p_email: string
          p_is_customer?: boolean
          p_is_supplier?: boolean
          p_name?: string
          p_odoo_partner_id?: number
        }
        Returns: number
      }
      upsert_topic: {
        Args: {
          p_category?: string
          p_company_id?: number
          p_priority?: string
          p_related_accounts?: string[]
          p_status?: string
          p_summary?: string
          p_topic: string
        }
        Returns: number
      }
      usd_to_mxn: { Args: { p_date?: string }; Returns: number }
      verify_fact: {
        Args: { p_fact_id: number; p_source?: string }
        Returns: undefined
      }
      verify_follow_ups: { Args: never; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
